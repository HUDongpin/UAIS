#!/usr/bin/env node

import { createServer } from "node:http";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";

const QWEN_VOICE_LIFECYCLE_AUDIT_FILENAME = "qwen-voice-lifecycle-audit.jsonl";
const MAX_BODY_BYTES = 1_000_000;
const EXTERNAL_STORAGE_API_CONTRACT_VERSION = "uais-external-storage-v1";
const EXTERNAL_STORAGE_SERVICE_TARGETS = {
  reference: "uais-external-storage-reference-service",
  production: "uais-external-storage-production-service",
};
const MIN_PRODUCTION_ACCESS_TOKEN_LENGTH = 32;
const teachingOperationAppendWriteQueues = new Map();

try {
  const options = parseArgs(process.argv.slice(2));
  const config = createConfig(options);
  const server = createExternalStorageServer(config);

  server.listen({ host: config.host, port: config.port }, () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("External storage service did not expose a TCP address.");
    }
    process.stdout.write(
      `${JSON.stringify({
        target: config.serviceTarget,
        status: "listening",
        host: address.address,
        port: address.port,
        serviceMode: config.serviceMode,
        responsibleSession: "S12/S22/S24",
        endpoints: [
          "GET /healthz",
          "GET /teacher-ai-ownership/{teacherId}",
          "POST /teacher-ai-ownership/{teacherId}/merge",
          "GET /teaching-course-management/database",
          "PUT /teaching-course-management/database",
          "POST /teaching-course-management/backups",
          "POST /teaching-course-management/backups/{backupId}/restore-drill",
          "GET /teaching-course-assets/database",
          "PUT /teaching-course-assets/database",
          "POST /teaching-course-assets/backups",
          "POST /teaching-course-assets/backups/{backupId}/restore-drill",
          "POST /teaching-operations/{teacherId}/append",
          "POST /teaching-operations/{teacherId}/backups",
          "POST /teaching-operations/{teacherId}/backups/{backupId}/restore-drill",
          "POST /teaching-operations/{teacherId}/records/{recordId}/rollback",
          "GET /teaching-operations/{teacherId}/audit",
          "GET /teaching-operations/{teacherId}/audit/alerts",
          "GET /teaching-operations/{teacherId}/audit/alerts/notifications",
          "POST /teaching-operations/{teacherId}/audit/alerts/notifications",
          "GET /qwen-voice-lifecycle-audit",
          "POST /qwen-voice-lifecycle-audit",
          "GET /langgraph/checkpoints/{namespace}",
          "PUT /langgraph/checkpoints/{namespace}",
          "GET /langgraph/store/{namespace}",
          "PUT /langgraph/store/{namespace}",
        ],
        safety: {
          bearerTokenOmitted: true,
          dataDirOmitted: true,
          localPrivatePathsOmitted: true,
          responseBodiesRedactedByContract: true,
        },
      })}\n`,
    );
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "External storage service failed."}\n`,
  );
  process.exitCode = 1;
}

function createExternalStorageServer(config) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${config.host}`);

      if (request.method === "GET" && url.pathname === "/healthz") {
        const durableBackingStore = await probeDurableBackingStore(config.dataDir);
        const adapterReady =
          config.serviceMode !== "production" ||
          isProductionDatabaseAdapterReady(config.productionDatabaseAdapter);
        const ready = durableBackingStore.status === "ready" && adapterReady;
        sendJson(response, ready ? 200 : 503, {
          status: ready ? "ok" : "blocked",
          target: config.serviceTarget,
          productionServiceIdentity: createProductionServiceIdentity(config),
          apiContractVersion: EXTERNAL_STORAGE_API_CONTRACT_VERSION,
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
          redaction: createRedaction(),
        });
        return;
      }

      if (!isAuthorized(request, config.accessToken)) {
        sendJson(response, 401, {
          error: "External storage authorization is required.",
          redaction: createRedaction(),
        });
        return;
      }

      const langGraphCheckpointMatch = url.pathname.match(/^\/langgraph\/checkpoints\/([^/]+)$/);
      if (langGraphCheckpointMatch) {
        const namespace = requireSafeLangGraphNamespace(
          decodeURIComponent(langGraphCheckpointMatch[1]),
        );
        await handleLangGraphSnapshotRequest({
          request,
          response,
          dataDir: config.dataDir,
          kind: "checkpoints",
          namespace,
        });
        return;
      }

      const langGraphStoreMatch = url.pathname.match(/^\/langgraph\/store\/([^/]+)$/);
      if (langGraphStoreMatch) {
        const namespace = requireSafeLangGraphNamespace(
          decodeURIComponent(langGraphStoreMatch[1]),
        );
        await handleLangGraphSnapshotRequest({
          request,
          response,
          dataDir: config.dataDir,
          kind: "store",
          namespace,
        });
        return;
      }

      const teacherOwnershipMatch = url.pathname.match(/^\/teacher-ai-ownership\/([^/]+)$/);
      if (request.method === "GET" && teacherOwnershipMatch) {
        const teacherId = requireSafeId(decodeURIComponent(teacherOwnershipMatch[1]), "teacher id");
        const ownership = await readTeacherOwnership({ dataDir: config.dataDir, teacherId });
        if (!ownership) {
          sendJson(response, 404, {
            error: "Teacher AI ownership record not found.",
            redaction: createRedaction(),
          });
          return;
        }
        sendJson(response, 200, ownership);
        return;
      }

      const teacherOwnershipMergeMatch = url.pathname.match(/^\/teacher-ai-ownership\/([^/]+)\/merge$/);
      if (request.method === "POST" && teacherOwnershipMergeMatch) {
        const teacherId = requireSafeId(decodeURIComponent(teacherOwnershipMergeMatch[1]), "teacher id");
        const body = await readJsonBody(request);
        if (body.action !== "merge-teacher-ai-ownership") {
          throw new HttpError(400, "Unsupported teacher ownership action.");
        }
        const incoming = normalizeOwnership(body.ownership);
        if (incoming.teacherId !== teacherId) {
          throw new HttpError(400, "Teacher AI ownership record id mismatch.");
        }
        const existing = await readTeacherOwnership({ dataDir: config.dataDir, teacherId });
        const merged = mergeOwnership(existing, incoming);
        await writeTeacherOwnership({ dataDir: config.dataDir, ownership: merged });
        sendJson(response, 200, {
          teacherId,
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
        return;
      }

      if (request.method === "GET" && url.pathname === "/teaching-course-management/database") {
        assertProductionDatabaseAdapterReadyForSnapshotReadback(config);
        sendJson(
          response,
          200,
          withProductionDatabaseAdapterEvidence(
            await readTeachingCourseManagementSnapshot(config.dataDir),
            config,
          ),
        );
        return;
      }

      if (request.method === "PUT" && url.pathname === "/teaching-course-management/database") {
        const body = await readJsonBody(request);
        if (body.action !== "replace-teaching-course-management-database") {
          throw new HttpError(400, "Unsupported teaching course management action.");
        }
        if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim()) {
          throw new HttpError(400, "Teaching course management expected revision is required.");
        }
        assertProductionDatabaseAdapterReadyForSnapshotReplace(config);
        sendJson(
          response,
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
        return;
      }

      if (request.method === "POST" && url.pathname === "/teaching-course-management/backups") {
        assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
        const backupRequest = normalizeTeachingCourseManagementBackupRequest(
          await readJsonBody(request),
        );
        sendJson(
          response,
          200,
          withProductionDatabaseAdapterEvidence(
            await createTeachingCourseManagementBackup({
              dataDir: config.dataDir,
              ...backupRequest,
            }),
            config,
          ),
        );
        return;
      }

      const teachingCourseManagementRestoreDrillMatch = url.pathname.match(/^\/teaching-course-management\/backups\/([^/]+)\/restore-drill$/);
      if (request.method === "POST" && teachingCourseManagementRestoreDrillMatch) {
        assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
        const backupId = requireSafeId(
          decodeURIComponent(teachingCourseManagementRestoreDrillMatch[1]),
          "teaching course management backup id",
        );
        const restoreDrillRequest = normalizeTeachingCourseManagementRestoreDrillRequest(
          await readJsonBody(request),
        );
        sendJson(
          response,
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
        return;
      }

      if (request.method === "GET" && url.pathname === "/teaching-course-assets/database") {
        assertProductionDatabaseAdapterReadyForSnapshotReadback(config);
        sendJson(
          response,
          200,
          withProductionDatabaseAdapterEvidence(
            await readTeachingCourseAssetsSnapshot(config.dataDir),
            config,
          ),
        );
        return;
      }

      if (request.method === "PUT" && url.pathname === "/teaching-course-assets/database") {
        const body = await readJsonBody(request);
        if (body.action !== "replace-teaching-course-assets-database") {
          throw new HttpError(400, "Unsupported teaching course assets action.");
        }
        if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim()) {
          throw new HttpError(400, "Teaching course assets expected revision is required.");
        }
        assertProductionDatabaseAdapterReadyForSnapshotReplace(config);
        sendJson(
          response,
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
        return;
      }

      if (request.method === "POST" && url.pathname === "/teaching-course-assets/backups") {
        assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
        const backupRequest = normalizeTeachingCourseAssetsBackupRequest(
          await readJsonBody(request),
        );
        sendJson(
          response,
          200,
          withProductionDatabaseAdapterEvidence(
            await createTeachingCourseAssetsBackup({
              dataDir: config.dataDir,
              ...backupRequest,
            }),
            config,
          ),
        );
        return;
      }

      const teachingCourseAssetsRestoreDrillMatch = url.pathname.match(/^\/teaching-course-assets\/backups\/([^/]+)\/restore-drill$/);
      if (request.method === "POST" && teachingCourseAssetsRestoreDrillMatch) {
        assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
        const backupId = requireSafeId(
          decodeURIComponent(teachingCourseAssetsRestoreDrillMatch[1]),
          "teaching course assets backup id",
        );
        const restoreDrillRequest = normalizeTeachingCourseAssetsRestoreDrillRequest(
          await readJsonBody(request),
        );
        sendJson(
          response,
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
        return;
      }

      const teachingOperationAppendMatch = url.pathname.match(/^\/teaching-operations\/([^/]+)\/append$/);
      if (request.method === "POST" && teachingOperationAppendMatch) {
        const teacherId = requireSafeId(decodeURIComponent(teachingOperationAppendMatch[1]), "teacher id");
        assertProductionDatabaseAdapterReadyForAppend(config);
        const body = await readJsonBody(request);
        if (body.action !== "append-teaching-operation") {
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
        sendJson(response, 200, {
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
        return;
      }

      const teachingOperationAuditMatch = url.pathname.match(/^\/teaching-operations\/([^/]+)\/audit$/);
      if (request.method === "GET" && teachingOperationAuditMatch) {
        assertProductionDatabaseAdapterReadyForAuditReadback(config);
        const teacherId = requireSafeId(decodeURIComponent(teachingOperationAuditMatch[1]), "teacher id");
        sendJson(
          response,
          200,
          withProductionDatabaseAdapterEvidence(
            await listTeachingOperationAuditReadback(config.dataDir, teacherId),
            config,
          ),
        );
        return;
      }

      const teachingOperationBackupMatch = url.pathname.match(/^\/teaching-operations\/([^/]+)\/backups$/);
      if (request.method === "POST" && teachingOperationBackupMatch) {
        assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
        const teacherId = requireSafeId(decodeURIComponent(teachingOperationBackupMatch[1]), "teacher id");
        const backupRequest = normalizeTeachingOperationBackupRequest(
          await readJsonBody(request),
        );
        sendJson(
          response,
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
        return;
      }

      const teachingOperationRestoreDrillMatch = url.pathname.match(/^\/teaching-operations\/([^/]+)\/backups\/([^/]+)\/restore-drill$/);
      if (request.method === "POST" && teachingOperationRestoreDrillMatch) {
        assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config);
        const teacherId = requireSafeId(decodeURIComponent(teachingOperationRestoreDrillMatch[1]), "teacher id");
        const backupId = requireSafeId(decodeURIComponent(teachingOperationRestoreDrillMatch[2]), "teaching operation backup id");
        const restoreDrillRequest = normalizeTeachingOperationRestoreDrillRequest(
          await readJsonBody(request),
        );
        sendJson(
          response,
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
        return;
      }

      const teachingOperationRollbackMatch = url.pathname.match(/^\/teaching-operations\/([^/]+)\/records\/([^/]+)\/rollback$/);
      if (request.method === "POST" && teachingOperationRollbackMatch) {
        assertProductionDatabaseAdapterReadyForRollback(config);
        const teacherId = requireSafeId(decodeURIComponent(teachingOperationRollbackMatch[1]), "teacher id");
        const recordId = requireSafeId(decodeURIComponent(teachingOperationRollbackMatch[2]), "teaching operation record id");
        const rollbackRequest = normalizeTeachingOperationRollbackRequest(
          await readJsonBody(request),
        );
        sendJson(
          response,
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
        return;
      }

      const teachingOperationAuditAlertsMatch = url.pathname.match(/^\/teaching-operations\/([^/]+)\/audit\/alerts$/);
      if (request.method === "GET" && teachingOperationAuditAlertsMatch) {
        assertProductionDatabaseAdapterReadyForAuditAlerts(config);
        const teacherId = requireSafeId(decodeURIComponent(teachingOperationAuditAlertsMatch[1]), "teacher id");
        sendJson(
          response,
          200,
          withProductionDatabaseAdapterEvidence(
            await summarizeTeachingOperationAuditAlerts(config.dataDir, teacherId),
            config,
          ),
        );
        return;
      }

      const teachingOperationAuditAlertNotificationsMatch = url.pathname.match(/^\/teaching-operations\/([^/]+)\/audit\/alerts\/notifications$/);
      if (teachingOperationAuditAlertNotificationsMatch) {
        const teacherId = requireSafeId(decodeURIComponent(teachingOperationAuditAlertNotificationsMatch[1]), "teacher id");
        if (request.method === "GET") {
          assertProductionDatabaseAdapterReadyForAuditAlertNotifications(config);
          sendJson(
            response,
            200,
            withProductionDatabaseAdapterEvidence(
              await listTeachingOperationAlertNotifications(config.dataDir, teacherId),
              config,
            ),
          );
          return;
        }
        if (request.method === "POST") {
          assertProductionDatabaseAdapterReadyForAuditAlertNotifications(config);
          const notificationRequest = normalizeAlertNotificationRequest(
            await readJsonBody(request),
          );
          sendJson(
            response,
            200,
            withProductionDatabaseAdapterEvidence(
              await enqueueTeachingOperationAlertNotifications({
                dataDir: config.dataDir,
                teacherId,
                adminAlertWebhook: config.adminAlertWebhook,
                fetch,
                ...notificationRequest,
              }),
              config,
            ),
          );
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/qwen-voice-lifecycle-audit") {
        sendJson(response, 200, await listLifecycleAuditEvents(config.dataDir));
        return;
      }

      if (request.method === "POST" && url.pathname === "/qwen-voice-lifecycle-audit") {
        const event = normalizeLifecycleAuditEvent(await readJsonBody(request));
        await appendLifecycleAuditEvent({ dataDir: config.dataDir, event });
        sendJson(response, 200, {
          eventId: event.eventId,
          provider: "qwen",
          providerRole: "voice-clone",
          action: "voice-clone-revoke",
          status: "recorded",
          storagePolicy: "append-only-redacted-lifecycle-audit",
          responsibleSession: "S12/S24",
          redaction: createRedaction(),
        });
        return;
      }

      sendJson(response, 404, {
        error: "External storage route not found.",
        redaction: createRedaction(),
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(response, status, {
        error:
          error instanceof HttpError
            ? error.message
            : "External storage service request failed.",
        redaction: createRedaction(),
      });
    }
  });
}

function parseArgs(args) {
  const options = {
    host: "127.0.0.1",
    port: 8787,
    dataDir: undefined,
    accessToken: undefined,
    serviceMode: "reference",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") {
      options.host = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--port") {
      const port = Number(readArgValue(args, index, arg));
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error("--port must be an integer from 0 to 65535.");
      }
      options.port = port;
      index += 1;
    } else if (arg === "--data-dir") {
      options.dataDir = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--access-token") {
      options.accessToken = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--service-mode") {
      const serviceMode = readArgValue(args, index, arg);
      if (serviceMode !== "reference" && serviceMode !== "production") {
        throw new Error("--service-mode must be reference or production.");
      }
      options.serviceMode = serviceMode;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/external-storage-service.mjs --data-dir PATH [--access-token TOKEN] [--host 127.0.0.1] [--port 8787] [--service-mode reference|production]",
          "",
          "Runs a file-backed UAIS external durable storage service. Prefer UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN over --access-token. Startup output omits tokens and local paths. Production mode only changes service identity and requires a strong token; production readiness still requires a remote HTTPS deployment and durable storage.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function createConfig(options) {
  if (!hasValue(options.dataDir)) {
    throw new Error("External storage service requires --data-dir.");
  }
  const accessToken = hasValue(options.accessToken)
    ? options.accessToken
    : process.env.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN;
  if (!hasValue(accessToken)) {
    throw new Error("External storage service requires --access-token or UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN.");
  }
  const normalizedAccessToken = accessToken.trim();
  if (
    options.serviceMode === "production" &&
    normalizedAccessToken.length < MIN_PRODUCTION_ACCESS_TOKEN_LENGTH
  ) {
    throw new Error("Production external storage service requires a strong access token.");
  }
  const adminAlertWebhookUrl =
    process.env.UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_URL?.trim();
  const adminAlertWebhookToken =
    process.env.UAIS_EXTERNAL_STORAGE_ADMIN_ALERT_WEBHOOK_TOKEN?.trim();

  return {
    host: options.host,
    port: options.port,
    dataDir: resolve(options.dataDir),
    accessToken: normalizedAccessToken,
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
    serviceMode: options.serviceMode,
    serviceTarget: EXTERNAL_STORAGE_SERVICE_TARGETS[options.serviceMode],
    productionDatabaseAdapter: createProductionDatabaseAdapterProofFromEnv({
      env: process.env,
      serviceMode: options.serviceMode,
    }),
  };
}

function normalizeAdminAlertWebhookUrl(value) {
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

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

async function readTeacherOwnership({ dataDir, teacherId }) {
  const filePath = resolveTeacherOwnershipPath(dataDir, teacherId);
  const raw = await readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return undefined;
  }
  const ownership = normalizeOwnership(JSON.parse(raw));
  if (ownership.teacherId !== teacherId) {
    throw new Error("Stored teacher AI ownership record id mismatch.");
  }
  return ownership;
}

async function writeTeacherOwnership({ dataDir, ownership }) {
  const normalized = normalizeOwnership(ownership);
  const ownershipDir = resolve(dataDir, "teacher-ai-ownership");
  ensureWithinBase(dataDir, ownershipDir);
  await mkdir(ownershipDir, { recursive: true });
  const filePath = resolveTeacherOwnershipPath(dataDir, normalized.teacherId);
  const tempPath = resolve(ownershipDir, `.${normalized.teacherId}.${Date.now()}.${randomUUID()}.tmp`);
  ensureWithinBase(dataDir, tempPath);
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

async function readTeachingCourseManagementSnapshot(dataDir) {
  const filePath = resolveTeachingCourseManagementSnapshotPath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createTeachingCourseManagementSnapshot(createEmptyTeachingCourseManagementDatabase());
  }
  const value = JSON.parse(raw);
  const database = normalizeTeachingCourseManagementDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseManagementRevision(database);
  return createTeachingCourseManagementSnapshot(database, revision);
}

async function replaceTeachingCourseManagementSnapshot({ dataDir, expectedRevision, database }) {
  const current = await readTeachingCourseManagementSnapshot(dataDir);
  if (current.revision !== expectedRevision) {
    throw new HttpError(409, "Teaching course management snapshot revision mismatch.");
  }

  const snapshot = createTeachingCourseManagementSnapshot(database);
  const snapshotDir = resolve(dataDir, "teaching-course-management");
  ensureWithinBase(dataDir, snapshotDir);
  await mkdir(snapshotDir, { recursive: true });
  const filePath = resolveTeachingCourseManagementSnapshotPath(dataDir);
  const tempPath = resolve(snapshotDir, `.database.${Date.now()}.${randomUUID()}.tmp`);
  ensureWithinBase(dataDir, tempPath);
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

function createTeachingCourseManagementSnapshot(database, revision = createTeachingCourseManagementRevision(database)) {
  return {
    database,
    revision,
    storagePolicy: "external-redacted-teaching-course-management-snapshot",
    redaction: createRedaction(),
  };
}

function createTeachingCourseManagementRevision(database) {
  if (
    database.updatedAt === "1970-01-01T00:00:00.000Z" &&
    database.courses.length === 0 &&
    database.classes.length === 0 &&
    database.memberships.length === 0 &&
    database.auditEvents.length === 0
  ) {
    return "rev-empty";
  }
  return `rev-${createHash("sha256")
    .update(JSON.stringify(database))
    .digest("hex")
    .slice(0, 16)}`;
}

function createEmptyTeachingCourseManagementDatabase() {
  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    courses: [],
    classes: [],
    memberships: [],
    auditEvents: [],
  };
}

async function readTeachingCourseAssetsSnapshot(dataDir) {
  const filePath = resolveTeachingCourseAssetsSnapshotPath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createTeachingCourseAssetsSnapshot(createEmptyTeachingCourseAssetsDatabase(), "rev-empty");
  }
  const value = JSON.parse(raw);
  const database = normalizeTeachingCourseAssetsDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseAssetsRevision(database);
  return createTeachingCourseAssetsSnapshot(database, revision);
}

async function replaceTeachingCourseAssetsSnapshot({ dataDir, expectedRevision, database }) {
  const current = await readTeachingCourseAssetsSnapshot(dataDir);
  if (current.revision !== expectedRevision) {
    throw new HttpError(409, "Teaching course assets snapshot revision mismatch.");
  }

  const snapshot = createTeachingCourseAssetsSnapshot(database);
  const snapshotDir = resolve(dataDir, "teaching-course-assets");
  ensureWithinBase(dataDir, snapshotDir);
  await mkdir(snapshotDir, { recursive: true });
  const filePath = resolveTeachingCourseAssetsSnapshotPath(dataDir);
  const tempPath = resolve(snapshotDir, `.database.${Date.now()}.${randomUUID()}.tmp`);
  ensureWithinBase(dataDir, tempPath);
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
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function createTeachingCourseAssetsSnapshot(
  database,
  revision = createTeachingCourseAssetsRevision(database),
) {
  return {
    database,
    revision,
    storagePolicy: "external-redacted-teaching-course-cover-assets",
    redaction: createRedaction(),
  };
}

function createTeachingCourseAssetsRevision(database) {
  if (
    database.updatedAt === "1970-01-01T00:00:00.000Z" &&
    database.assets.length === 0 &&
    database.auditEvents.length === 0
  ) {
    return "rev-empty";
  }
  return `rev-${createHash("sha256")
    .update(JSON.stringify(database))
    .digest("hex")
    .slice(0, 16)}`;
}

function createEmptyTeachingCourseAssetsDatabase() {
  return {
    schemaVersion: "uais-teaching-course-assets-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    assets: [],
    auditEvents: [],
  };
}

async function createTeachingCourseManagementBackup({
  dataDir,
  requestedBy,
  requestedAt,
  traceId,
}) {
  const snapshot = await readTeachingCourseManagementSnapshot(dataDir);
  const sourceRecordCounts = countTeachingCourseManagementBackupSnapshot(snapshot);
  const backupId = requireSafeId(
    `teaching-course-management-backup-${formatTimestampId(requestedAt)}`,
    "teaching course management backup id",
  );
  const backup = normalizeTeachingCourseManagementBackup({
    backupId,
    status: "persisted",
    eventType: "teaching-course-management-backup.created",
    traceId,
    requestedBy,
    requestedAt,
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-management-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await writeTeachingCourseManagementBackup({ dataDir, backup });
  return createTeachingCourseManagementBackupReceipt(backup);
}

async function verifyTeachingCourseManagementBackupRestoreDrill({
  dataDir,
  backupId,
  requestedBy,
  requestedAt,
  traceId,
}) {
  const backup = await readTeachingCourseManagementBackup({ dataDir, backupId });
  if (!backup) {
    throw new HttpError(404, "Teaching course management backup was not found.");
  }
  const drill = normalizeTeachingCourseManagementRestoreDrill({
    backupId,
    drillId: requireSafeId(
      `teaching-course-management-restore-drill-${backupId}`,
      "teaching course management restore drill id",
    ),
    status: "verified",
    eventType: "teaching-course-management-backup.restore-drill-verified",
    traceId,
    requestedBy,
    requestedAt,
    restoredRecordCounts: countTeachingCourseManagementBackupSnapshot(backup.snapshot),
    storagePolicy: "external-redacted-teaching-course-management-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await appendTeachingCourseManagementRestoreDrill({ dataDir, drill });
  return drill;
}

async function createTeachingCourseAssetsBackup({
  dataDir,
  requestedBy,
  requestedAt,
  traceId,
}) {
  const snapshot = await readTeachingCourseAssetsSnapshot(dataDir);
  const sourceRecordCounts = countTeachingCourseAssetsBackupSnapshot(snapshot);
  const backupId = requireSafeId(
    `teaching-course-assets-backup-${formatTimestampId(requestedAt)}`,
    "teaching course assets backup id",
  );
  const backup = normalizeTeachingCourseAssetsBackup({
    backupId,
    status: "persisted",
    eventType: "teaching-course-assets-backup.created",
    traceId,
    requestedBy,
    requestedAt,
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-assets-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await writeTeachingCourseAssetsBackup({ dataDir, backup });
  return createTeachingCourseAssetsBackupReceipt(backup);
}

async function verifyTeachingCourseAssetsBackupRestoreDrill({
  dataDir,
  backupId,
  requestedBy,
  requestedAt,
  traceId,
}) {
  const backup = await readTeachingCourseAssetsBackup({ dataDir, backupId });
  if (!backup) {
    throw new HttpError(404, "Teaching course assets backup was not found.");
  }
  const drill = normalizeTeachingCourseAssetsRestoreDrill({
    backupId,
    drillId: requireSafeId(
      `teaching-course-assets-restore-drill-${backupId}`,
      "teaching course assets restore drill id",
    ),
    status: "verified",
    eventType: "teaching-course-assets-backup.restore-drill-verified",
    traceId,
    requestedBy,
    requestedAt,
    restoredRecordCounts: countTeachingCourseAssetsBackupSnapshot(backup.snapshot),
    storagePolicy: "external-redacted-teaching-course-assets-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  });
  await appendTeachingCourseAssetsRestoreDrill({ dataDir, drill });
  return drill;
}

async function writeTeachingCourseManagementBackup({ dataDir, backup }) {
  const backupDir = resolve(dataDir, "teaching-course-management-backups");
  ensureWithinBase(dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const filePath = resolveTeachingCourseManagementBackupPath(dataDir, backup.backupId);
  const tempPath = resolve(
    backupDir,
    `.${backup.backupId}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(backup, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readTeachingCourseManagementBackup({ dataDir, backupId }) {
  const backupPath = resolveTeachingCourseManagementBackupPath(dataDir, backupId);
  const raw = await readFile(backupPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return undefined;
  }
  const backup = normalizeTeachingCourseManagementBackup(JSON.parse(raw));
  if (backup.backupId !== backupId) {
    throw new Error("Stored teaching course management backup id mismatch.");
  }
  return backup;
}

async function appendTeachingCourseManagementRestoreDrill({ dataDir, drill }) {
  const normalizedDrill = normalizeTeachingCourseManagementRestoreDrill(drill);
  await mkdir(dataDir, { recursive: true });
  await appendFile(
    resolveTeachingCourseManagementRestoreDrillLogPath(dataDir),
    `${JSON.stringify(normalizedDrill)}\n`,
    "utf8",
  );
}

async function writeTeachingCourseAssetsBackup({ dataDir, backup }) {
  const backupDir = resolve(dataDir, "teaching-course-assets-backups");
  ensureWithinBase(dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const filePath = resolveTeachingCourseAssetsBackupPath(dataDir, backup.backupId);
  const tempPath = resolve(
    backupDir,
    `.${backup.backupId}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(backup, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readTeachingCourseAssetsBackup({ dataDir, backupId }) {
  const backupPath = resolveTeachingCourseAssetsBackupPath(dataDir, backupId);
  const raw = await readFile(backupPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return undefined;
  }
  const backup = normalizeTeachingCourseAssetsBackup(JSON.parse(raw));
  if (backup.backupId !== backupId) {
    throw new Error("Stored teaching course assets backup id mismatch.");
  }
  return backup;
}

async function appendTeachingCourseAssetsRestoreDrill({ dataDir, drill }) {
  const normalizedDrill = normalizeTeachingCourseAssetsRestoreDrill(drill);
  await mkdir(dataDir, { recursive: true });
  await appendFile(
    resolveTeachingCourseAssetsRestoreDrillLogPath(dataDir),
    `${JSON.stringify(normalizedDrill)}\n`,
    "utf8",
  );
}

async function appendLifecycleAuditEvent({ dataDir, event }) {
  const normalized = normalizeLifecycleAuditEvent(event);
  const auditPath = resolveLifecycleAuditPath(dataDir);
  await mkdir(dataDir, { recursive: true });
  await appendFile(auditPath, `${JSON.stringify(normalized)}\n`, "utf8");
}

async function appendTeachingOperation({ dataDir, teacherId, record, auditEvent }) {
  const operationPath = resolveTeachingOperationLogPath(dataDir, teacherId);
  return runWithTeachingOperationAppendWriteLock(operationPath, async () => {
    const existingRecords = await listTeachingOperationRecords(dataDir, teacherId);
    const existingRecordIndex = existingRecords.findIndex(
      (storedRecord) => storedRecord.recordId === record.recordId,
    );
    const existingRecord =
      existingRecordIndex >= 0 ? existingRecords[existingRecordIndex] : undefined;
    if (existingRecord) {
      if (
        areTeachingOperationRecordsEquivalent(existingRecord, record) ||
        areIdempotentTeachingOperationRecordsEquivalent(existingRecord, record)
      ) {
        return {
          idempotencyStatus: "already-persisted",
          appendSequence: existingRecordIndex + 1,
        };
      }
      throw new HttpError(409, "Teaching operation record id already exists.");
    }

    const appendSequence = existingRecords.length + 1;
    const operationDir = resolve(dataDir, "teaching-operations");
    ensureWithinBase(dataDir, operationDir);
    await mkdir(operationDir, { recursive: true });
    await appendFile(
      operationPath,
      `${JSON.stringify({
        record,
        ...(auditEvent ? { auditEvent } : {}),
        appendSequence,
        storagePolicy: "external-redacted-teaching-operation-append",
        storageWritePolicy: "external-append-only-operation-log",
        responsibleSession: "S12",
        redaction: createRedaction(),
      })}\n`,
      "utf8",
    );
    if (auditEvent) {
      await appendTeachingOperationAuditEvent({ dataDir, teacherId, auditEvent });
    }
    return { idempotencyStatus: "created", appendSequence };
  });
}

async function runWithTeachingOperationAppendWriteLock(operationPath, action) {
  const previous = teachingOperationAppendWriteQueues.get(operationPath) ?? Promise.resolve();
  let releaseCurrent = () => undefined;
  const current = new Promise((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  teachingOperationAppendWriteQueues.set(operationPath, queued);

  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    releaseCurrent();
    if (teachingOperationAppendWriteQueues.get(operationPath) === queued) {
      teachingOperationAppendWriteQueues.delete(operationPath);
    }
  }
}

function areTeachingOperationRecordsEquivalent(left, right) {
  return (
    JSON.stringify(stripTeachingOperationAppendSequence(left)) ===
    JSON.stringify(stripTeachingOperationAppendSequence(right))
  );
}

function areIdempotentTeachingOperationRecordsEquivalent(left, right) {
  return Boolean(
    left.idempotencyKey &&
      right.idempotencyKey &&
      left.recordId === right.recordId &&
      left.idempotencyKey === right.idempotencyKey &&
      left.operationId === right.operationId &&
      left.actionSlot === right.actionSlot &&
      left.actionId === right.actionId &&
      left.actorId === right.actorId &&
      (left.courseId ?? "") === (right.courseId ?? "") &&
      (left.sourceAction ?? "") === (right.sourceAction ?? ""),
  );
}

function stripTeachingOperationAppendSequence(record) {
  const rest = { ...record };
  delete rest.appendSequence;
  return rest;
}

async function createTeachingOperationBackup({
  dataDir,
  teacherId,
  requestedBy,
  requestedAt,
  traceId,
}) {
  const snapshot = {
    operations: await listTeachingOperationRecords(dataDir, teacherId),
    auditEvents: (await listTeachingOperationAuditEvents(dataDir, teacherId)).events,
    rollbacks: await listTeachingOperationRollbackRecords(dataDir, teacherId),
    alertNotifications: (await listTeachingOperationAlertNotifications(dataDir, teacherId))
      .notifications,
  };
  const sourceRecordCounts = countTeachingOperationBackupSnapshot(snapshot);
  const backupId = requireSafeId(
    `teaching-operations-backup-${teacherId}-${formatTimestampId(requestedAt)}`,
    "teaching operation backup id",
  );
  const backup = {
    teacherId,
    backupId,
    status: "persisted",
    eventType: "teaching-operation-backup.created",
    traceId,
    requestedBy,
    requestedAt,
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-operation-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
  await writeTeachingOperationBackup({ dataDir, teacherId, backup });
  return createTeachingOperationBackupReceipt(backup);
}

async function rollbackTeachingOperation({
  dataDir,
  teacherId,
  recordId,
  courseId,
  rollbackReason,
  traceId,
  requestedAt,
  requestSource,
}) {
  const record = await findTeachingOperationRecord({ dataDir, teacherId, recordId });
  if (!record) {
    throw new HttpError(404, "Teaching operation record was not found.");
  }
  if (!record.courseId) {
    throw new HttpError(409, "Teaching operation record has no course scope.");
  }
  if (record.courseId !== courseId) {
    throw new HttpError(409, "Teaching operation rollback course id mismatch.");
  }
  const existingRollbacks = await listTeachingOperationRollbackRecords(dataDir, teacherId);
  if (existingRollbacks.some((rollback) => rollback.targetRecordId === recordId)) {
    throw new HttpError(409, "Teaching operation record has already been rolled back.");
  }

  const rollback = {
    rollbackId: requireSafeId(
      `teaching-operation-rollback-${recordId}`,
      "teaching operation rollback id",
    ),
    action: "rollback-teaching-operation-record",
    teacherId,
    targetRecordId: recordId,
    courseId: record.courseId,
    targetOperationId: record.operationId,
    targetActionSlot: record.actionSlot,
    targetActionId: record.actionId,
    rollbackReason,
    status: "persisted",
    rolledBackAt: requestedAt,
    storagePolicy: "external-redacted-teaching-operation-rollback",
    storageWritePolicy: "external-append-only-rollback-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
  await appendTeachingOperationRollback({ dataDir, teacherId, rollback });
  await appendTeachingOperationAuditEvent({
    dataDir,
    teacherId,
    auditEvent: createTeachingOperationRollbackAuditEvent({
      teacherId,
      record,
      rollbackReason,
      traceId,
      requestedAt,
      requestSource,
    }),
  });

  return rollback;
}

async function verifyTeachingOperationBackupRestoreDrill({
  dataDir,
  teacherId,
  backupId,
  requestedBy,
  requestedAt,
  traceId,
}) {
  const backup = await readTeachingOperationBackup({ dataDir, teacherId, backupId });
  if (!backup) {
    throw new HttpError(404, "Teaching operation backup was not found.");
  }
  const drill = {
    teacherId,
    backupId,
    drillId: requireSafeId(
      `teaching-operations-restore-drill-${backupId}`,
      "teaching operation restore drill id",
    ),
    status: "verified",
    eventType: "teaching-operation-backup.restore-drill-verified",
    traceId,
    requestedBy,
    requestedAt,
    restoredRecordCounts: countTeachingOperationBackupSnapshot(backup.snapshot),
    storagePolicy: "external-redacted-teaching-operation-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
  await appendTeachingOperationRestoreDrill({ dataDir, teacherId, drill });
  return drill;
}

async function findTeachingOperationRecord({ dataDir, teacherId, recordId }) {
  const operationPath = resolveTeachingOperationLogPath(dataDir, teacherId);
  const raw = await readFile(operationPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });

  for (const line of raw.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const entry = normalizeTeachingOperationLogEntry(JSON.parse(line), teacherId);
    if (entry.record.recordId === recordId) {
      return entry.record;
    }
  }
  return undefined;
}

function normalizeTeachingOperationLogEntry(value, teacherId) {
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

async function listTeachingOperationRecords(dataDir, teacherId) {
  const operationPath = resolveTeachingOperationLogPath(dataDir, teacherId);
  const raw = await readFile(operationPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeTeachingOperationLogEntry(JSON.parse(line), teacherId).record);
}

async function writeTeachingOperationBackup({ dataDir, teacherId, backup }) {
  const backupDir = resolve(dataDir, "teaching-operation-backups", teacherId);
  ensureWithinBase(dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const filePath = resolveTeachingOperationBackupPath(dataDir, teacherId, backup.backupId);
  const tempPath = resolve(
    backupDir,
    `.${backup.backupId}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(dataDir, tempPath);
  try {
    await writeFile(tempPath, JSON.stringify(backup, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readTeachingOperationBackup({ dataDir, teacherId, backupId }) {
  const backupPath = resolveTeachingOperationBackupPath(dataDir, teacherId, backupId);
  const raw = await readFile(backupPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return undefined;
  }
  const backup = normalizeTeachingOperationBackup(JSON.parse(raw));
  if (backup.teacherId !== teacherId || backup.backupId !== backupId) {
    throw new Error("Stored teaching operation backup id mismatch.");
  }
  return backup;
}

async function appendTeachingOperationRestoreDrill({ dataDir, teacherId, drill }) {
  const normalizedDrill = normalizeTeachingOperationRestoreDrill(drill);
  const restoreDrillDir = resolve(dataDir, "teaching-operation-restore-drills");
  ensureWithinBase(dataDir, restoreDrillDir);
  await mkdir(restoreDrillDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationRestoreDrillLogPath(dataDir, teacherId),
    `${JSON.stringify(normalizedDrill)}\n`,
    "utf8",
  );
}

async function appendTeachingOperationRollback({ dataDir, teacherId, rollback }) {
  const rollbackDir = resolve(dataDir, "teaching-operation-rollbacks");
  ensureWithinBase(dataDir, rollbackDir);
  await mkdir(rollbackDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationRollbackLogPath(dataDir, teacherId),
    `${JSON.stringify({
      rollback,
      storagePolicy: "external-redacted-teaching-operation-rollback",
      storageWritePolicy: "external-append-only-rollback-log",
      responsibleSession: "S12",
      redaction: createRedaction(),
    })}\n`,
    "utf8",
  );
}

async function appendTeachingOperationAuditEvent({ dataDir, teacherId, auditEvent }) {
  const auditPath = resolveTeachingOperationAuditLogPath(dataDir, teacherId);
  const auditDir = resolve(dataDir, "teaching-operations-audit");
  ensureWithinBase(dataDir, auditDir);
  await mkdir(auditDir, { recursive: true });
  await appendFile(
    auditPath,
    `${JSON.stringify({
      auditEvent,
      storagePolicy: "external-redacted-teaching-operation-audit-log",
      storageWritePolicy: "external-append-only-audit-log",
      responsibleSession: "S12",
      redaction: createRedaction(),
    })}\n`,
    "utf8",
  );
}

async function probeDurableBackingStore(dataDir) {
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
    await writeFile(probePath, probePayload, {
      encoding: "utf8",
      flag: "wx",
    });
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
  ready,
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
  ready,
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
  ready,
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

function createProductionDatabaseAdapterProofFromEnv({ env, serviceMode }) {
  if (serviceMode !== "production") {
    return createBlockedProductionDatabaseAdapter();
  }
  const adapter = {
    status: "ready",
    providerClass: env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS,
    migrationStatus: env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS,
    backupPolicy: env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY,
    concurrencyControl:
      env.UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL,
    valueRedacted: true,
  };
  return isProductionDatabaseAdapterReady(adapter)
    ? adapter
    : createBlockedProductionDatabaseAdapter();
}

function isProductionDatabaseAdapterReady(adapter) {
  return (
    isRecord(adapter) &&
    adapter.status === "ready" &&
    adapter.providerClass === "managed-database" &&
    adapter.migrationStatus === "up-to-date" &&
    adapter.backupPolicy === "point-in-time-restore" &&
    adapter.concurrencyControl === "transactional" &&
    adapter.valueRedacted === true
  );
}

function assertProductionDatabaseAdapterReadyForAppend(config) {
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

function assertProductionDatabaseAdapterReadyForSnapshotReplace(config) {
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

function assertProductionDatabaseAdapterReadyForSnapshotReadback(config) {
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

function assertProductionDatabaseAdapterReadyForBackupAndRestoreDrill(config) {
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

function assertProductionDatabaseAdapterReadyForRollback(config) {
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

function assertProductionDatabaseAdapterReadyForAuditReadback(config) {
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

function assertProductionDatabaseAdapterReadyForAuditAlerts(config) {
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

function assertProductionDatabaseAdapterReadyForAuditAlertNotifications(config) {
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

function withProductionDatabaseAdapterEvidence(value, config) {
  return {
    ...value,
    productionDatabaseAdapter: config.productionDatabaseAdapter,
  };
}

function createBlockedProductionDatabaseAdapter() {
  return {
    status: "blocked",
    providerClass: "not-configured",
    migrationStatus: "blocked",
    backupPolicy: "not-configured",
    concurrencyControl: "blocked",
    valueRedacted: true,
  };
}

async function listLifecycleAuditEvents(dataDir) {
  const auditPath = resolveLifecycleAuditPath(dataDir);
  const raw = await readFile(auditPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
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

async function listTeachingOperationAuditEvents(dataDir, teacherId) {
  const auditPath = resolveTeachingOperationAuditLogPath(dataDir, teacherId);
  const raw = await readFile(auditPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeTeachingOperationAuditLedgerEntry(JSON.parse(line), teacherId))
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

async function listTeachingOperationAuditReadback(dataDir, teacherId) {
  const audit = await listTeachingOperationAuditEvents(dataDir, teacherId);
  const records = await listTeachingOperationRecords(dataDir, teacherId);
  const rollbackRecords = await listTeachingOperationRollbackRecords(dataDir, teacherId);
  const domainProjections = records.flatMap((record) => record.domainProjections ?? []);

  return {
    ...audit,
    auditEvents: audit.events,
    records,
    rollbackRecords,
    domainProjections,
    operationRecordCount: records.length,
    rollbackRecordCount: rollbackRecords.length,
    domainProjectionCount: domainProjections.length,
  };
}

async function summarizeTeachingOperationAuditAlerts(dataDir, teacherId) {
  const audit = await listTeachingOperationAuditEvents(dataDir, teacherId);
  const alerts = audit.events
    .filter((event) => event.eventType === "teaching-operation.persisted" && !event.courseId)
    .map((event) => {
      if (!event.operationId || !event.actionSlot || !event.actionId) {
        throw new HttpError(400, "Teaching operation audit alert source is invalid.");
      }
      return {
        alertId: `missing-course-context-${event.auditId}`,
        severity: "high",
        reason: "missing-course-context",
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

async function enqueueTeachingOperationAlertNotifications({
  dataDir,
  teacherId,
  requestedBy,
  requestedAt,
  adminAlertWebhook,
  fetch: fetchImpl,
}) {
  const summary = await summarizeTeachingOperationAuditAlerts(dataDir, teacherId);
  const notifications = summary.alerts.map((alert) =>
    createTeachingOperationAlertNotification({
      teacherId,
      alert,
      requestedBy,
      requestedAt,
    }),
  );
  if (notifications.length > 0) {
    await appendTeachingOperationAlertNotifications({
      dataDir,
      teacherId,
      notifications,
    });
  }
  const externalDelivery =
    notifications.length > 0
      ? await deliverTeachingOperationAlertNotifications({
          dataDir,
          teacherId,
          notifications,
          requestedBy,
          requestedAt,
          adminAlertWebhook,
          fetch: fetchImpl,
        })
      : undefined;

  return {
    teacherId,
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

async function appendTeachingOperationAlertNotifications({
  dataDir,
  teacherId,
  notifications,
}) {
  const notificationDir = resolve(dataDir, "teaching-operation-alert-notifications");
  ensureWithinBase(dataDir, notificationDir);
  await mkdir(notificationDir, { recursive: true });
  const payload = notifications
    .map((notification) => JSON.stringify(notification))
    .join("\n");
  await appendFile(
    resolveTeachingOperationAlertNotificationLogPath(dataDir, teacherId),
    `${payload}\n`,
    "utf8",
  );
}

async function deliverTeachingOperationAlertNotifications({
  dataDir,
  teacherId,
  notifications,
  requestedBy,
  requestedAt,
  adminAlertWebhook,
  fetch: fetchImpl,
}) {
  if (!adminAlertWebhook) {
    return undefined;
  }

  const webhookBody = {
    eventType: "teaching-operation-audit-alert-notification-webhook",
    teacherId,
    requestedBy,
    requestedAt,
    notificationCount: notifications.length,
    notifications,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  if (adminAlertWebhook.token) {
    headers.set("authorization", `Bearer ${adminAlertWebhook.token}`);
  }

  let responseStatus = 0;
  let deliveryStatus = "failed";
  try {
    const response = await fetchImpl(adminAlertWebhook.url, {
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
    teacherId,
    requestedBy,
    requestedAt,
    responseStatus,
    deliveryStatus,
    notifications,
  });
  await appendTeachingOperationAlertWebhookDelivery({
    dataDir,
    teacherId,
    delivery,
  });

  return delivery;
}

async function appendTeachingOperationAlertWebhookDelivery({
  dataDir,
  teacherId,
  delivery,
}) {
  const deliveryDir = resolve(
    dataDir,
    "teaching-operation-alert-webhook-deliveries",
  );
  ensureWithinBase(dataDir, deliveryDir);
  await mkdir(deliveryDir, { recursive: true });
  await appendFile(
    resolveTeachingOperationAlertWebhookDeliveryLogPath(dataDir, teacherId),
    `${JSON.stringify(normalizeTeachingOperationAlertWebhookDelivery(delivery))}\n`,
    "utf8",
  );
}

async function listTeachingOperationAlertNotifications(dataDir, teacherId) {
  const notificationPath = resolveTeachingOperationAlertNotificationLogPath(
    dataDir,
    teacherId,
  );
  const raw = await readFile(notificationPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });
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

async function listTeachingOperationRollbackRecords(dataDir, teacherId) {
  const rollbackPath = resolveTeachingOperationRollbackLogPath(dataDir, teacherId);
  const raw = await readFile(rollbackPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeTeachingOperationRollbackLedgerEntry(JSON.parse(line), teacherId));
}

function createTeachingOperationAlertNotification({
  teacherId,
  alert,
  requestedBy,
  requestedAt,
}) {
  return {
    notificationId: requireSafeId(
      `alert-notification-${alert.alertId}`,
      "teaching operation alert notification id",
    ),
    eventType: "teaching-operation-audit-alert-notification",
    deliveryChannel: "admin-outbox",
    deliveryStatus: "queued",
    teacherId,
    alertId: alert.alertId,
    severity: alert.severity,
    reason: alert.reason,
    auditId: alert.auditId,
    traceId: alert.traceId,
    actorId: alert.actorId,
    operationId: alert.operationId,
    actionSlot: alert.actionSlot,
    actionId: alert.actionId,
    requestedBy,
    requestedAt,
    queuedAt: requestedAt,
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function createTeachingOperationAlertWebhookDelivery({
  teacherId,
  requestedBy,
  requestedAt,
  responseStatus,
  deliveryStatus,
  notifications,
}) {
  const firstNotification = notifications[0];
  return {
    deliveryId: requireSafeId(
      firstNotification
        ? `alert-webhook-delivery-${firstNotification.alertId}`
        : `alert-webhook-delivery-${teacherId}`,
      "teaching operation alert webhook delivery id",
    ),
    eventType: "teaching-operation-audit-alert-webhook-delivery",
    deliveryChannel: "admin-webhook",
    deliveryStatus,
    provider: "configured-admin-alert-webhook",
    endpoint: "redacted",
    teacherId,
    requestedBy,
    requestedAt,
    deliveredAt: new Date().toISOString(),
    responseStatus,
    notificationCount: notifications.length,
    notificationIds: notifications.map((notification) => notification.notificationId),
    traceIds: notifications.map((notification) => notification.traceId),
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-webhook-delivery",
    storageWritePolicy: "external-append-only-webhook-delivery-ledger",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function createTeachingOperationRollbackAuditEvent({
  teacherId,
  record,
  rollbackReason,
  traceId,
  requestedAt,
  requestSource,
}) {
  return {
    auditId: requireSafeId(
      `audit-teaching-operation-rollback-${record.recordId}`,
      "teaching operation rollback audit id",
    ),
    traceId,
    eventType: "teaching-operation.rolled-back",
    actorId: teacherId,
    actorRole: "teacher",
    authMode: "signed-teacher-session",
    courseId: record.courseId,
    targetRecordId: record.recordId,
    operationId: record.operationId,
    actionSlot: record.actionSlot,
    actionId: record.actionId,
    rollbackReason,
    requestSource,
    createdAt: requestedAt,
    redaction: createRedaction(),
  };
}

function createTeachingOperationBackupReceipt(backup) {
  return {
    teacherId: backup.teacherId,
    backupId: backup.backupId,
    status: "persisted",
    eventType: "teaching-operation-backup.created",
    traceId: backup.traceId,
    requestedBy: backup.requestedBy,
    requestedAt: backup.requestedAt,
    sourceRecordCounts: backup.sourceRecordCounts,
    storagePolicy: "external-redacted-teaching-operation-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function countTeachingOperationBackupSnapshot(input) {
  return {
    operations: input.operations.length,
    auditEvents: input.auditEvents.length,
    rollbacks: input.rollbacks.length,
    alertNotifications: input.alertNotifications.length,
  };
}

function createTeachingCourseManagementBackupReceipt(backup) {
  return {
    backupId: backup.backupId,
    status: "persisted",
    eventType: "teaching-course-management-backup.created",
    traceId: backup.traceId,
    requestedBy: backup.requestedBy,
    requestedAt: backup.requestedAt,
    sourceRecordCounts: backup.sourceRecordCounts,
    storagePolicy: "external-redacted-teaching-course-management-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function createTeachingCourseAssetsBackupReceipt(backup) {
  return {
    backupId: backup.backupId,
    status: "persisted",
    eventType: "teaching-course-assets-backup.created",
    traceId: backup.traceId,
    requestedBy: backup.requestedBy,
    requestedAt: backup.requestedAt,
    sourceRecordCounts: backup.sourceRecordCounts,
    storagePolicy: "external-redacted-teaching-course-assets-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function countTeachingCourseManagementBackupSnapshot(input) {
  return {
    courses: input.database.courses.length,
    classes: input.database.classes.length,
    memberships: input.database.memberships.length,
    auditEvents: input.database.auditEvents.length,
  };
}

function countTeachingCourseAssetsBackupSnapshot(input) {
  return {
    assets: input.database.assets.length,
    auditEvents: input.database.auditEvents.length,
  };
}

function normalizeOwnership(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teacher AI ownership record must be an object.");
  }

  return {
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    courseIds: uniqueSafeIds(value.courseIds, "course id"),
    sampleAssets: arrayOrEmpty(value.sampleAssets).map((asset) => {
      requireRecord(asset, "sample asset");
      return {
        sampleAssetId: requireSafeId(asset.sampleAssetId, "sample asset id"),
        ...(asset.courseId ? { courseId: requireSafeId(asset.courseId, "course id") } : {}),
      };
    }),
    pptAssets: arrayOrEmpty(value.pptAssets).map((asset) => {
      requireRecord(asset, "PPT asset");
      return {
        pptAssetId: requireSafeId(asset.pptAssetId, "PPT asset id"),
        ...(asset.courseId ? { courseId: requireSafeId(asset.courseId, "course id") } : {}),
      };
    }),
    clonedVoiceRefs: arrayOrEmpty(value.clonedVoiceRefs).map((reference) => {
      requireRecord(reference, "cloned voice reference");
      return {
        voiceRefId: requireSafeId(reference.voiceRefId, "voice reference id"),
        ...(reference.sampleAssetId
          ? { sampleAssetId: requireSafeId(reference.sampleAssetId, "sample asset id") }
          : {}),
      };
    }),
    audioManifests: arrayOrEmpty(value.audioManifests).map((manifest) => {
      requireRecord(manifest, "audio manifest");
      return {
        audioManifestId: requireSafeId(manifest.audioManifestId, "audio manifest id"),
        ...(manifest.courseId ? { courseId: requireSafeId(manifest.courseId, "course id") } : {}),
        ...(manifest.pptAssetId ? { pptAssetId: requireSafeId(manifest.pptAssetId, "PPT asset id") } : {}),
        ...(manifest.voiceRefId ? { voiceRefId: requireSafeId(manifest.voiceRefId, "voice reference id") } : {}),
      };
    }),
  };
}

function normalizeTeachingCourseManagementDatabase(value) {
  if (!isRecord(value) || value.schemaVersion !== "uais-teaching-course-management-v1") {
    throw new HttpError(400, "Teaching course management database is invalid.");
  }
  return {
    schemaVersion: "uais-teaching-course-management-v1",
    updatedAt:
      typeof value.updatedAt === "string"
        ? requireIsoDate(value.updatedAt, "updatedAt")
        : "1970-01-01T00:00:00.000Z",
    courses: arrayOrEmpty(value.courses).map(normalizeTeachingCourseRecord),
    classes: arrayOrEmpty(value.classes).map(normalizeTeachingClassRecord),
    memberships: arrayOrEmpty(value.memberships).map(normalizeTeachingClassMembershipRecord),
    ...(Array.isArray(value.inviteCodeDrafts)
      ? { inviteCodeDrafts: value.inviteCodeDrafts.map(normalizeTeachingInviteCodeDraftRecord) }
      : {}),
    ...(Array.isArray(value.courseSettings)
      ? { courseSettings: value.courseSettings.map(normalizeTeachingCourseSettingsRecord) }
      : {}),
    ...(Array.isArray(value.studentPreviewSessions)
      ? {
          studentPreviewSessions: value.studentPreviewSessions.map(
            normalizeTeachingStudentPreviewSessionRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.studentRosters)
      ? { studentRosters: value.studentRosters.map(normalizeTeachingStudentRosterSyncRecord) }
      : {}),
    ...(Array.isArray(value.studentGroupSuggestions)
      ? {
          studentGroupSuggestions: value.studentGroupSuggestions.map(
            normalizeTeachingStudentGroupSuggestionRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.knowledgeIndexes)
      ? { knowledgeIndexes: value.knowledgeIndexes.map(normalizeTeachingKnowledgeIndexSyncRecord) }
      : {}),
    ...(Array.isArray(value.resourceReviewItems)
      ? {
          resourceReviewItems: value.resourceReviewItems.map(
            normalizeTeachingResourceReviewItemRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.contentPackages)
      ? { contentPackages: value.contentPackages.map(normalizeTeachingCourseContentPublishRecord) }
      : {}),
    ...(Array.isArray(value.courseUnitDrafts)
      ? { courseUnitDrafts: value.courseUnitDrafts.map(normalizeTeachingCourseUnitDraftRecord) }
      : {}),
    ...(Array.isArray(value.dashboardStates)
      ? { dashboardStates: value.dashboardStates.map(normalizeTeachingDashboardStateRecord) }
      : {}),
    ...(Array.isArray(value.dashboardSnapshots)
      ? { dashboardSnapshots: value.dashboardSnapshots.map(normalizeTeachingDashboardSnapshotRecord) }
      : {}),
    ...(Array.isArray(value.quizAssessments)
      ? { quizAssessments: value.quizAssessments.map(normalizeTeachingQuizAssessmentRecord) }
      : {}),
    ...(Array.isArray(value.quizItemReviews)
      ? { quizItemReviews: value.quizItemReviews.map(normalizeTeachingQuizItemReviewRecord) }
      : {}),
    ...(Array.isArray(value.agentSettings)
      ? { agentSettings: value.agentSettings.map(normalizeTeachingAgentSettingsRecord) }
      : {}),
    ...(Array.isArray(value.agentPermissionPreflights)
      ? {
          agentPermissionPreflights: value.agentPermissionPreflights.map(
            normalizeTeachingAgentPermissionPreflightRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.adminSettings)
      ? { adminSettings: value.adminSettings.map(normalizeTeachingAdminSettingsRecord) }
      : {}),
    ...(Array.isArray(value.collaborationInviteNotifications)
      ? {
          collaborationInviteNotifications: value.collaborationInviteNotifications.map(
            normalizeTeachingCollaborationInviteNotificationRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.exportManifests)
      ? { exportManifests: value.exportManifests.map(normalizeTeachingExportManifestRecord) }
      : {}),
    ...(Array.isArray(value.exportRedactionValidations)
      ? {
          exportRedactionValidations: value.exportRedactionValidations.map(
            normalizeTeachingExportRedactionValidationRecord,
          ),
        }
      : {}),
    ...(Array.isArray(value.gradingQueues)
      ? { gradingQueues: value.gradingQueues.map(normalizeTeachingGradingQueueRecord) }
      : {}),
    ...(Array.isArray(value.gradebookUpdates)
      ? { gradebookUpdates: value.gradebookUpdates.map(normalizeTeachingGradebookUpdateRecord) }
      : {}),
    ...(Array.isArray(value.gradingFeedbackDrafts)
      ? {
          gradingFeedbackDrafts: value.gradingFeedbackDrafts.map(
            normalizeTeachingGradingFeedbackDraftRecord,
          ),
        }
      : {}),
    auditEvents: arrayOrEmpty(value.auditEvents).map(normalizeTeachingCourseAuditEvent),
  };
}

function normalizeTeachingCourseRecord(value) {
  requireRecord(value, "teaching course record");
  return {
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    courseName: requireTrimmedString(value.courseName, "course name", 200),
    instructor: requireTrimmedString(value.instructor, "instructor", 120),
    unit: requireTrimmedString(value.unit, "unit", 160),
    department: requireTrimmedString(value.department, "department", 160),
    semester: requireTrimmedString(value.semester, "semester", 120),
    ...(value.description ? { description: requireTrimmedString(value.description, "description", 600) } : {}),
    ...(value.coverAssetId ? { coverAssetId: requireSafeId(value.coverAssetId, "cover asset id") } : {}),
    status: "draft",
    students: requireNonNegativeInteger(value.students, "students"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingClassRecord(value) {
  requireRecord(value, "teaching class record");
  return {
    classId: requireSafeId(value.classId, "class id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    className: requireTrimmedString(value.className, "class name", 160),
    students: requireNonNegativeInteger(value.students, "students"),
    semester: requireTrimmedString(value.semester, "semester", 120),
    invitationCode: requireInviteCode(value.invitationCode),
    joinUrl: requireSafeUrlPath(value.joinUrl, "join url"),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingClassMembershipRecord(value) {
  requireRecord(value, "teaching class membership record");
  return {
    membershipId: requireSafeId(value.membershipId, "membership id"),
    courseId: requireSafeId(value.courseId, "course id"),
    classId: requireSafeId(value.classId, "class id"),
    invitationCode: requireInviteCode(value.invitationCode),
    studentId: requireSafeId(value.studentId, "student id"),
    studentDisplayName: requireTrimmedString(value.studentDisplayName, "student display name", 160),
    membershipStatus: value.membershipStatus === "approved" ? "approved" : "pending-teacher-review",
    ...(value.approvedAt ? { approvedAt: requireIsoDate(value.approvedAt, "approvedAt") } : {}),
    ...(value.approvedByTeacherId ? { approvedByTeacherId: requireSafeId(value.approvedByTeacherId, "approved by teacher id") } : {}),
    joinedAt: requireIsoDate(value.joinedAt, "joinedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseSettingsRecord(value) {
  requireRecord(value, "teaching course settings record");
  return {
    settingsId: requireSafeId(value.settingsId, "course settings id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    updatedBy: requireSafeId(value.updatedBy, "updated by teacher id"),
    settingsStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    appliedFields: normalizeTeachingCourseSettingsAppliedFields(value.appliedFields),
    ...(value.courseName ? { courseName: requireTrimmedString(value.courseName, "course name", 200) } : {}),
    ...(value.instructor ? { instructor: requireTrimmedString(value.instructor, "instructor", 120) } : {}),
    ...(value.unit ? { unit: requireTrimmedString(value.unit, "unit", 160) } : {}),
    ...(value.department ? { department: requireTrimmedString(value.department, "department", 160) } : {}),
    ...(value.semester ? { semester: requireTrimmedString(value.semester, "semester", 120) } : {}),
    ...(typeof value.description === "string"
      ? { description: requireTrimmedString(value.description, "description", 600) }
      : {}),
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseSettingsAppliedFields(value) {
  const allowedFields = new Set([
    "courseName",
    "instructor",
    "unit",
    "department",
    "semester",
    "description",
  ]);
  if (!Array.isArray(value)) {
    return [];
  }
  const fields = [];
  for (const field of value) {
    if (allowedFields.has(field) && !fields.includes(field)) {
      fields.push(field);
    }
  }
  return fields;
}

function normalizeTeachingStudentPreviewSessionRecord(value) {
  requireRecord(value, "teaching student preview session record");
  return {
    previewSessionId: requireSafeId(value.previewSessionId, "student preview session id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    previewedBy: requireSafeId(value.previewedBy, "previewed by teacher id"),
    previewStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    previewId: requireSafeId(value.previewId, "student preview id"),
    previewUrl: requireSafeUrlPath(value.previewUrl, "student preview url"),
    previewScope: "teacher-course-preview",
    previewPolicy: "teacher-visible-preview-only",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingInviteCodeDraftRecord(value) {
  requireRecord(value, "teaching invite code draft record");
  const inviteCode = requireInviteCode(value.inviteCode);
  return {
    inviteCodeDraftId: requireSafeId(value.inviteCodeDraftId, "invite code draft id"),
    courseId: requireSafeId(value.courseId, "course id"),
    classId: requireSafeId(value.classId, "class id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    draftStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    inviteCode,
    joinUrl: requireSafeUrlPath(value.joinUrl || `/courses?invite=${inviteCode}`, "join url"),
    invitePolicy: "teacher-review-before-publication",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingStudentRosterSyncRecord(value) {
  requireRecord(value, "teaching student roster sync record");
  return {
    rosterId: requireSafeId(value.rosterId, "student roster id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    syncedBy: requireSafeId(value.syncedBy, "synced by teacher id"),
    syncStatus: "local-recount",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    approvedStudentCount: requireNonNegativeInteger(value.approvedStudentCount, "approved student count"),
    pendingTeacherReviewCount: requireNonNegativeInteger(value.pendingTeacherReviewCount, "pending teacher review count"),
    classCount: requireNonNegativeInteger(value.classCount, "class count"),
    sourceSystems: ["local-class-memberships", "local-class-records"],
    ...(value.providerStatus === "sis-provider-synced"
      ? { providerStatus: "sis-provider-synced" }
      : {}),
    ...(value.providerSyncId
      ? { providerSyncId: requireSafeId(value.providerSyncId, "provider sync id") }
      : {}),
    ...(value.providerSyncedAt
      ? { providerSyncedAt: requireIsoDate(value.providerSyncedAt, "providerSyncedAt") }
      : {}),
    syncedAt: requireIsoDate(value.syncedAt, "syncedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingStudentGroupSuggestionGroup(value) {
  requireRecord(value, "teaching student group suggestion group");
  if (!Array.isArray(value.members)) {
    throw new HttpError(400, "Teaching student group suggestion group members must be an array.");
  }
  return {
    groupName: requireTrimmedString(value.groupName, "learning group name", 120),
    members: value.members.map((member) => {
      requireRecord(member, "teaching student group suggestion member");
      return {
        studentId: requireSafeId(member.studentId, "student id"),
        studentDisplayName: requireTrimmedString(
          member.studentDisplayName,
          "student display name",
          120,
        ),
      };
    }),
  };
}

function normalizeTeachingStudentGroupSuggestionRecord(value) {
  requireRecord(value, "teaching student group suggestion record");
  return {
    groupSuggestionId: requireSafeId(value.groupSuggestionId, "student group suggestion id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    suggestionStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    suggestionScope: "teacher-editable-student-groups",
    suggestedGroups: Array.isArray(value.suggestedGroups)
      ? value.suggestedGroups.map(normalizeTeachingStudentGroupSuggestionGroup)
      : [],
    ungroupedStudentCount: requireNonNegativeInteger(
      value.ungroupedStudentCount ?? 0,
      "ungrouped student count",
    ),
    sourceSignals: ["approved-class-memberships", "existing-learning-groups"],
    reviewPolicy: "teacher-review-before-group-assignment",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingKnowledgeIndexSyncRecord(value) {
  requireRecord(value, "teaching knowledge index sync record");
  return {
    indexId: requireSafeId(value.indexId, "knowledge index id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    syncedBy: requireSafeId(value.syncedBy, "synced by teacher id"),
    syncStatus: "synced",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    sourceSystems: ["course-files", "teacher-resources", "agent-grounding-index"],
    ...(value.providerStatus === "knowledge-provider-synced"
      ? { providerStatus: "knowledge-provider-synced" }
      : {}),
    ...(value.providerSyncId
      ? { providerSyncId: requireSafeId(value.providerSyncId, "provider sync id") }
      : {}),
    ...(value.providerSyncedAt
      ? { providerSyncedAt: requireIsoDate(value.providerSyncedAt, "providerSyncedAt") }
      : {}),
    syncedAt: requireIsoDate(value.syncedAt, "syncedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingResourceReviewItemRecord(value) {
  requireRecord(value, "teaching resource review item record");
  const commonRecord = {
    resourceReviewItemId: requireSafeId(value.resourceReviewItemId, "resource review item id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    queuedBy: requireSafeId(value.queuedBy, "queued by teacher id"),
    reviewStatus: "pending-teacher-review",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    reviewPolicy: "teacher-review-before-knowledge-index",
    queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };

  if (value.resourceSource === "teacher-placeholder") {
    return {
      ...commonRecord,
      resourceSource: "teacher-placeholder",
    };
  }

  if (value.resourceSource !== "teacher-submitted-url") {
    throw new HttpError(400, "Invalid teaching knowledge resource source.");
  }

  const resource = normalizeTeachingKnowledgeResourceMetadata(value);
  return {
    ...commonRecord,
    resourceSource: "teacher-submitted-url",
    ...resource,
  };
}

function normalizeTeachingKnowledgeResourceMetadata(value) {
  const title = typeof value.title === "string" ? value.title.trim().replace(/\s+/g, " ") : "";
  if (
    !title ||
    title.length > 160 ||
    /\/Users\/|[A-Za-z]:\\Users\\|(?:api[_ -]?key|secret|token)\s*[:=]|bearer\s+[A-Za-z0-9._-]{8,}/i.test(
      title,
    )
  ) {
    throw new HttpError(400, "Invalid teaching knowledge resource metadata.");
  }

  if (typeof value.sourceUrl !== "string" || value.sourceUrl.length > 2_048) {
    throw new HttpError(400, "Invalid teaching knowledge resource metadata.");
  }

  let source;
  try {
    source = new URL(value.sourceUrl.trim());
  } catch {
    throw new HttpError(400, "Invalid teaching knowledge resource metadata.");
  }
  const hostname = source.hostname.toLowerCase().replace(/\.$/, "");
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isIP(hostname) !== 0 ||
    !hostname.includes(".")
  ) {
    throw new HttpError(400, "Invalid teaching knowledge resource metadata.");
  }

  const sourceUrl = source.toString();
  const expectedFingerprint = `sha256:${createHash("sha256")
    .update(sourceUrl, "utf8")
    .digest("hex")}`;
  if (value.sourceFingerprint !== expectedFingerprint) {
    throw new HttpError(400, "Invalid teaching knowledge resource metadata.");
  }

  const allowedRightsBases = new Set([
    "owner-created",
    "licensed",
    "open-access",
    "permission-granted",
  ]);
  if (!allowedRightsBases.has(value.rightsBasis) || value.visibility !== "course-only") {
    throw new HttpError(400, "Invalid teaching knowledge resource metadata.");
  }

  return {
    title,
    sourceUrl,
    sourceFingerprint: expectedFingerprint,
    rightsBasis: value.rightsBasis,
    visibility: "course-only",
  };
}

function normalizeTeachingCourseContentPublishRecord(value) {
  requireRecord(value, "teaching course content publish record");
  return {
    contentId: requireSafeId(value.contentId, "course content id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    publishedBy: requireSafeId(value.publishedBy, "published by teacher id"),
    publicationStatus: "published",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    releaseScope: "course-visible-content",
    publishedAt: requireIsoDate(value.publishedAt, "publishedAt"),
    ...(value.providerStatus === "content-provider-published"
      ? { providerStatus: "content-provider-published" }
      : {}),
    ...(value.providerPublishId
      ? { providerPublishId: requireSafeId(value.providerPublishId, "provider publish id") }
      : {}),
    ...(value.providerPublishedAt
      ? { providerPublishedAt: requireIsoDate(value.providerPublishedAt, "providerPublishedAt") }
      : {}),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseUnitDraftRecord(value) {
  requireRecord(value, "teaching course unit draft record");
  return {
    unitDraftId: requireSafeId(value.unitDraftId, "course unit draft id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    draftStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    draftScope: "teacher-editable-unit-plan",
    sourceSystems: ["course-knowledge-index", "teaching-objectives", "quiz-bank"],
    reviewPolicy: "teacher-review-before-student-release",
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingDashboardStateRecord(value) {
  requireRecord(value, "teaching dashboard state record");
  return {
    dashboardStateId: requireSafeId(value.dashboardStateId, "dashboard state id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    refreshedBy: requireSafeId(value.refreshedBy, "refreshed by teacher id"),
    refreshStatus: "refreshed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    visibleMetrics: ["engagement", "progress", "assessment-quality"],
    refreshPolicy: "teacher-visible-course-dashboard",
    refreshedAt: requireIsoDate(value.refreshedAt, "refreshedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingDashboardSnapshotRecord(value) {
  requireRecord(value, "teaching dashboard snapshot record");
  return {
    dashboardSnapshotId: requireSafeId(value.dashboardSnapshotId, "dashboard snapshot id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    lockedBy: requireSafeId(value.lockedBy, "locked by teacher id"),
    snapshotStatus: "locked",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    teachingOperationSnapshotId: requireSafeId(
      value.teachingOperationSnapshotId,
      "teaching operation dashboard snapshot id",
    ),
    snapshotScope: "daily-course-dashboard",
    retentionPolicy: "teacher-locked-dashboard-snapshot",
    lockedAt: requireIsoDate(value.lockedAt, "lockedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingQuizAssessmentRecord(value) {
  requireRecord(value, "teaching quiz assessment record");
  return {
    quizAssessmentId: requireSafeId(value.quizAssessmentId, "quiz assessment id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    refreshedBy: requireSafeId(value.refreshedBy, "refreshed by teacher id"),
    assessmentStatus: "refreshed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    quizBoardStateId: requireSafeId(value.quizBoardStateId, "quiz board state id"),
    visibleMetrics: ["completion-rate", "item-quality", "misconception-clusters"],
    reviewPolicy: "teacher-visible-quiz-quality-board",
    reusePolicy: "teacher-review-before-quiz-reuse",
    refreshedAt: requireIsoDate(value.refreshedAt, "refreshedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingQuizItemReviewRecord(value) {
  requireRecord(value, "teaching quiz item review record");
  return {
    quizItemReviewId: requireSafeId(value.quizItemReviewId, "quiz item review id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    flaggedBy: requireSafeId(value.flaggedBy, "flagged by teacher id"),
    reviewStatus: "flagged-for-review",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    flaggedSignals: ["low-discrimination", "high-error-rate", "teacher-review-needed"],
    reviewPolicy: "teacher-review-before-quiz-reuse",
    flaggedAt: requireIsoDate(value.flaggedAt, "flaggedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingAdminSettingsRecord(value) {
  requireRecord(value, "teaching admin settings record");
  return {
    adminSettingsId: requireSafeId(value.adminSettingsId, "admin settings id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    savedBy: requireSafeId(value.savedBy, "saved by teacher id"),
    settingsStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    adminScopes: ["course-collaborators", "permission-boundary", "audit-routing"],
    governancePolicy: "teacher-controlled-admin-settings",
    savedAt: requireIsoDate(value.savedAt, "savedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingAgentSettingsRecord(value) {
  requireRecord(value, "teaching agent settings record");
  return {
    agentSettingsId: requireSafeId(value.agentSettingsId, "agent settings id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    savedBy: requireSafeId(value.savedBy, "saved by teacher id"),
    settingsStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    agentScopes: ["research-agent", "method-agent", "writing-agent", "math-agent"],
    governancePolicy: "teacher-controlled-agent-settings",
    savedAt: requireIsoDate(value.savedAt, "savedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingAgentPermissionPreflightRecord(value) {
  requireRecord(value, "teaching agent permission preflight record");
  return {
    preflightId: requireSafeId(value.preflightId, "agent permission preflight id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    checkedBy: requireSafeId(value.checkedBy, "checked by teacher id"),
    preflightStatus: "passed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
    preflightPolicy: "teacher-agent-permission-gate",
    checkedAt: requireIsoDate(value.checkedAt, "checkedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCollaborationInviteNotificationRecord(value) {
  requireRecord(value, "teaching collaboration invite notification record");
  const notificationStatus =
    value.notificationStatus === "delivery-failed"
      ? "delivery-failed"
      : value.notificationStatus === "delivered-to-provider"
      ? "delivered-to-provider"
      : "queued-for-provider";
  const providerStatus =
    value.providerStatus === "smtp-provider-bounced"
      ? "smtp-provider-bounced"
      : value.providerStatus === "smtp-provider-delivered"
      ? "smtp-provider-delivered"
      : "smtp-provider-pending";
  return {
    notificationId: requireSafeId(value.notificationId, "collaboration invite notification id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    queuedBy: requireSafeId(value.queuedBy, "queued by teacher id"),
    notificationStatus,
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    outboxId: requireSafeId(value.outboxId, "collaboration invite outbox id"),
    deliveryChannel: "collaboration-invite-email",
    providerStatus,
    ...(notificationStatus === "delivered-to-provider" || notificationStatus === "delivery-failed"
      ? {
          providerDeliveryId: requireSafeId(
            value.providerDeliveryId,
            "collaboration invite provider delivery id",
          ),
        }
      : {}),
    ...(notificationStatus === "delivery-failed"
      ? {
          deliveryFailureReason: requireSafeId(
            value.deliveryFailureReason,
            "collaboration invite delivery failure reason",
          ),
          providerCallbackAt: requireIsoDate(value.providerCallbackAt, "providerCallbackAt"),
        }
      : {}),
    deliveryPolicy: "server-outbox-before-smtp-provider",
    queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
    ...(notificationStatus === "delivered-to-provider" || notificationStatus === "delivery-failed"
      ? { deliveredAt: requireIsoDate(value.deliveredAt, "deliveredAt") }
      : {}),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingExportManifestRecord(value) {
  requireRecord(value, "teaching export manifest record");
  const teachingOperationManifestId = requireSafeId(
    value.teachingOperationManifestId,
    "teaching operation manifest id",
  );
  return {
    exportManifestId: requireSafeId(value.exportManifestId, "export manifest id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    createdBy: requireSafeId(value.createdBy, "created by teacher id"),
    exportStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    teachingOperationManifestId,
    downloadRoute:
      typeof value.downloadRoute === "string" && value.downloadRoute.trim()
        ? value.downloadRoute.trim()
        : `/api/teaching/operations/export/${teachingOperationManifestId}`,
    datasetScopes: ["learning-records", "chat-threads", "grades", "activities"],
    formats: ["json", "csv"],
    exportPolicy: "redacted-teacher-export-manifest",
    ...(value.providerStatus === "export-provider-exported"
      ? { providerStatus: "export-provider-exported" }
      : {}),
    ...(value.providerExportId
      ? { providerExportId: requireSafeId(value.providerExportId, "provider export id") }
      : {}),
    ...(value.providerExportedAt
      ? { providerExportedAt: requireIsoDate(value.providerExportedAt, "providerExportedAt") }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingExportRedactionValidationRecord(value) {
  requireRecord(value, "teaching export redaction validation record");
  return {
    exportRedactionValidationId: requireSafeId(
      value.exportRedactionValidationId,
      "export redaction validation id",
    ),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    validatedBy: requireSafeId(value.validatedBy, "validated by teacher id"),
    validationStatus: "passed",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    checkedScopes: [
      "identity-fields",
      "ai-chat-transcripts",
      "voice-references",
      "local-file-paths",
    ],
    blockedSecretCount: 0,
    validationPolicy: "no-secrets-or-local-paths-before-export",
    validatedAt: requireIsoDate(value.validatedAt, "validatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingGradingQueueRecord(value) {
  requireRecord(value, "teaching grading queue record");
  return {
    gradingQueueId: requireSafeId(value.gradingQueueId, "grading queue id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    savedBy: requireSafeId(value.savedBy, "saved by teacher id"),
    queueStatus: "saved",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
    reviewPolicy: "teacher-review-before-release",
    releasePolicy: "teacher-confirmed-grade-release",
    savedAt: requireIsoDate(value.savedAt, "savedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingGradebookUpdateRecord(value) {
  requireRecord(value, "teaching gradebook update record");
  return {
    objectId: requireSafeId(value.objectId, "gradebook update id"),
    objectType: "gradebook-update",
    courseId: requireSafeId(value.courseId, "course id"),
    updatedBy: requireSafeId(value.updatedBy, "updated by teacher id"),
    updateStatus:
      value.updateStatus === "release-rolled-back"
        ? "release-rolled-back"
        : value.updateStatus === "released"
          ? "released"
          : "pending-release",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    releasePolicy: "teacher-confirmed-grade-release",
    updatedAt: requireIsoDate(value.updatedAt, "updatedAt"),
    ...(value.releasedBy ? { releasedBy: requireSafeId(value.releasedBy, "released by") } : {}),
    ...(value.releasedAt ? { releasedAt: requireIsoDate(value.releasedAt, "releasedAt") } : {}),
    ...(value.providerStatus === "gradebook-provider-released"
      ? { providerStatus: "gradebook-provider-released" }
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
    storagePolicy: "domain-projection-teaching-gradebook-update",
    redaction: createRedaction(),
  };
}

function normalizeTeachingGradingFeedbackDraftRecord(value) {
  requireRecord(value, "teaching grading feedback draft record");
  return {
    gradingFeedbackDraftId: requireSafeId(value.gradingFeedbackDraftId, "grading feedback draft id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ownerTeacherId: requireSafeId(value.ownerTeacherId, "owner teacher id"),
    generatedBy: requireSafeId(value.generatedBy, "generated by teacher id"),
    feedbackStatus: "generated",
    operationRecordId: requireSafeId(value.operationRecordId, "operation record id"),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    teachingOperationFeedbackArtifactId: requireSafeId(
      value.teachingOperationFeedbackArtifactId,
      "teaching operation feedback artifact id",
    ),
    feedbackScope: "grading-review-queue",
    reviewPolicy: "teacher-review-before-student-release",
    releasePolicy: "teacher-confirmed-feedback-release",
    ...(value.providerStatus === "feedback-provider-generated"
      ? { providerStatus: "feedback-provider-generated" }
      : {}),
    ...(value.providerFeedbackId
      ? { providerFeedbackId: requireSafeId(value.providerFeedbackId, "provider feedback id") }
      : {}),
    ...(value.providerGeneratedAt
      ? { providerGeneratedAt: requireIsoDate(value.providerGeneratedAt, "providerGeneratedAt") }
      : {}),
    generatedAt: requireIsoDate(value.generatedAt, "generatedAt"),
    storagePolicy: normalizeTeachingCourseRecordStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeTeachingCourseStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseAuditEvent(value) {
  requireRecord(value, "teaching course audit event");
  return {
    auditId: requireSafeId(value.auditId, "audit id"),
    action: normalizeTeachingCourseAction(value.action),
    actorId: requireSafeId(value.actorId, "actor id"),
    courseId: requireSafeId(value.courseId, "course id"),
    ...(value.classId ? { classId: requireSafeId(value.classId, "class id") } : {}),
    traceId: requireSafeId(value.traceId, "trace id"),
    actorRole: value.actorRole === "student" ? "student" : "teacher",
    authMode: value.authMode === "app-student-session" ? "app-student-session" : "signed-teacher-session",
    ...(value.authSession
      ? { authSession: normalizeSignedSessionAuditAuthSession(value.authSession) }
      : {}),
    requestSource: normalizeTeachingAuditRequestSource(value.requestSource),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    storagePolicy:
      value.storagePolicy === "external-redacted-teaching-course-management-audit-log"
        ? "external-redacted-teaching-course-management-audit-log"
        : "local-json-teaching-course-management-audit-log",
    redaction: createRedaction(),
  };
}

function normalizeTeachingAuditRequestSource(value) {
  requireRecord(value, "teaching audit request source");
  if (value.ipAddress !== "redacted") {
    throw new HttpError(400, "Teaching audit request source is invalid.");
  }
  return {
    userAgent:
      typeof value.userAgent === "string" &&
      value.userAgent.trim() &&
      !/\/Users\/|secret|api[_-]?key|token/i.test(value.userAgent)
        ? value.userAgent.trim().slice(0, 160)
        : "redacted",
    ipAddress: "redacted",
  };
}

function normalizeSignedSessionAuditAuthSession(value) {
  requireRecord(value, "teaching audit auth session");
  return {
    sessionId: requireSafeId(value.sessionId, "auth session id"),
    authenticatedAt: requireIsoDate(value.authenticatedAt, "authenticatedAt"),
    expiresAt: requireIsoDate(value.expiresAt, "expiresAt"),
  };
}

function normalizeTeachingCourseAction(value) {
  if (
    value === "create-course" ||
    value === "bind-course-cover-asset" ||
    value === "create-class" ||
    value === "save-course-settings" ||
    value === "generate-student-preview-session" ||
    value === "sync-student-roster" ||
    value === "sync-student-roster-provider" ||
    value === "generate-student-group-suggestions" ||
    value === "sync-knowledge-index" ||
    value === "sync-knowledge-index-provider" ||
    value === "queue-resource-review-item" ||
    value === "publish-course-content" ||
    value === "publish-course-content-provider" ||
    value === "generate-course-unit-draft" ||
    value === "refresh-dashboard" ||
    value === "lock-dashboard-snapshot" ||
    value === "refresh-quiz-assessment" ||
    value === "flag-quiz-item-review" ||
    value === "save-agent-settings" ||
    value === "record-agent-permission-preflight" ||
    value === "save-admin-settings" ||
    value === "queue-collaboration-invite-notification" ||
    value === "deliver-collaboration-invite-email" ||
    value === "record-collaboration-invite-email-delivery-callback" ||
    value === "create-export-manifest" ||
    value === "export-course-data-provider" ||
    value === "validate-export-redaction-scope" ||
    value === "save-grading-queue" ||
    value === "generate-grading-feedback-draft" ||
    value === "generate-grading-feedback-provider" ||
    value === "generate-class-invite-code-draft" ||
    value === "publish-class-invite-code" ||
    value === "join-class-by-invite" ||
    value === "approve-class-membership"
  ) {
    return value;
  }
  throw new HttpError(400, "Invalid teaching course management action.");
}

function normalizeTeachingCourseRecordStoragePolicy(value) {
  return value === "external-redacted-teaching-course-management-snapshot"
    ? "external-redacted-teaching-course-management-snapshot"
    : "local-json-teaching-course-management";
}

function normalizeTeachingCourseStorageWritePolicy(value) {
  return value === "external-optimistic-snapshot-replace"
    ? "external-optimistic-snapshot-replace"
    : "atomic-json-file-replace";
}

function normalizeTeachingCourseAssetsDatabase(value) {
  if (!isRecord(value) || value.schemaVersion !== "uais-teaching-course-assets-v1") {
    throw new HttpError(400, "Teaching course assets database is invalid.");
  }
  return {
    schemaVersion: "uais-teaching-course-assets-v1",
    updatedAt:
      typeof value.updatedAt === "string"
        ? requireIsoDate(value.updatedAt, "updatedAt")
        : "1970-01-01T00:00:00.000Z",
    assets: arrayOrEmpty(value.assets).map(normalizeTeachingCourseCoverAsset),
    auditEvents: arrayOrEmpty(value.auditEvents).map(normalizeTeachingCourseCoverAuditEvent),
  };
}

function normalizeTeachingCourseCoverAsset(value) {
  requireRecord(value, "teaching course cover asset");
  if (value.assetType !== "course-cover") {
    throw new HttpError(400, "Teaching course cover asset type is invalid.");
  }
  return {
    assetId: requireSafeId(value.assetId, "asset id"),
    assetType: "course-cover",
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    courseName: requireTrimmedString(value.courseName, "course name", 300),
    provider: "qwen",
    providerRole: "image-generation",
    imageUrl: requireHttpsUrl(value.imageUrl, "image url"),
    model: requireSafeModel(value.model, "model"),
    ...(value.providerRequestId
      ? { providerRequestId: requireSafeId(value.providerRequestId, "provider request id") }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    storagePolicy: normalizeCourseCoverAssetStoragePolicy(value.storagePolicy),
    storageWritePolicy: normalizeCourseCoverAssetStorageWritePolicy(value.storageWritePolicy),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseCoverAuditEvent(value) {
  requireRecord(value, "teaching course cover audit event");
  requireRecord(value.requestSource, "teaching course cover audit request source");
  if (
    value.eventType !== "teaching-course-cover.generated" ||
    value.actorRole !== "teacher" ||
    value.authMode !== "signed-teacher-session" ||
    value.requestSource.ipAddress !== "redacted"
  ) {
    throw new HttpError(400, "Teaching course cover audit event policy is invalid.");
  }
  return {
    auditId: requireSafeId(value.auditId, "audit id"),
    traceId: requireSafeId(value.traceId, "trace id"),
    eventType: "teaching-course-cover.generated",
    actorId: requireSafeId(value.actorId, "actor id"),
    actorRole: "teacher",
    authMode: "signed-teacher-session",
    ...(value.authSession
      ? { authSession: normalizeTeachingCourseCoverAuditAuthSession(value.authSession) }
      : {}),
    courseId: requireSafeId(value.courseId, "course id"),
    assetId: requireSafeId(value.assetId, "asset id"),
    ...(value.providerRequestId
      ? { providerRequestId: requireSafeId(value.providerRequestId, "provider request id") }
      : {}),
    requestSource: {
      userAgent:
        typeof value.requestSource.userAgent === "string" &&
        value.requestSource.userAgent.trim() &&
        !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
          ? value.requestSource.userAgent.trim().slice(0, 160)
          : "redacted",
      ipAddress: "redacted",
    },
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    storagePolicy: normalizeCourseCoverAuditStoragePolicy(value.storagePolicy),
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseCoverAuditAuthSession(value) {
  requireRecord(value, "teaching course cover audit auth session");
  return {
    sessionId: requireSafeId(value.sessionId, "auth session id"),
    authenticatedAt: requireIsoDate(value.authenticatedAt, "authenticatedAt"),
    expiresAt: requireIsoDate(value.expiresAt, "expiresAt"),
  };
}

function normalizeCourseCoverAssetStoragePolicy(value) {
  return value === "external-redacted-teaching-course-cover-assets"
    ? "external-redacted-teaching-course-cover-assets"
    : "local-json-teaching-course-cover-assets";
}

function normalizeCourseCoverAssetStorageWritePolicy(value) {
  return value === "external-optimistic-snapshot-replace"
    ? "external-optimistic-snapshot-replace"
    : "atomic-json-file-replace";
}

function normalizeCourseCoverAuditStoragePolicy(value) {
  return value === "external-redacted-teaching-course-cover-audit-log"
    ? "external-redacted-teaching-course-cover-audit-log"
    : "local-json-teaching-course-cover-audit-log";
}

function normalizeLifecycleAuditEvent(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Lifecycle audit event must be an object.");
  }
  if (
    value.eventType !== "qwen-voice-lifecycle" ||
    value.provider !== "qwen" ||
    value.providerRole !== "voice-clone" ||
    value.action !== "voice-clone-revoke" ||
    value.status !== "recorded"
  ) {
    throw new HttpError(400, "Lifecycle audit event shape is invalid.");
  }
  requireRecord(value.actor, "lifecycle audit actor");
  requireRecord(value.resource, "lifecycle audit resource");
  requireRecord(value.providerRevocation, "provider revocation");
  requireRecord(value.localReference, "local reference");
  requireRecord(value.localAuditRecord, "local audit record");
  if (
    value.providerRevocation.status !== "revoked" ||
    value.localReference.status !== "deleted" ||
    value.localAuditRecord.storagePolicy !== "local-redacted-lifecycle-audit" ||
    value.storagePolicy !== "append-only-redacted-lifecycle-audit" ||
    value.responsibleSession !== "S12/S24"
  ) {
    throw new HttpError(400, "Lifecycle audit event policy is invalid.");
  }

  const deletionReason = value.deletionReason;
  if (deletionReason !== "owner-request" && deletionReason !== "source-sample-deletion") {
    throw new HttpError(400, "Lifecycle audit deletion reason is invalid.");
  }

  return {
    eventId: requireSafeId(value.eventId, "lifecycle audit event id"),
    eventType: "qwen-voice-lifecycle",
    provider: "qwen",
    providerRole: "voice-clone",
    action: "voice-clone-revoke",
    status: "recorded",
    occurredAt: requireIsoDate(value.occurredAt, "occurredAt"),
    actor: {
      actorId: requireSafeId(value.actor.actorId, "actor id"),
      role: requireSafeRole(value.actor.role),
    },
    resource: {
      teacherId: requireSafeId(value.resource.teacherId, "teacher id"),
      sampleAssetId: requireSafeId(value.resource.sampleAssetId, "sample asset id"),
      voiceRefId: requireSafeId(value.resource.voiceRefId, "voice reference id"),
    },
    deletionReason,
    providerRevocation: {
      status: "revoked",
      ...(value.providerRevocation.requestId
        ? { requestId: requireSafeId(value.providerRevocation.requestId, "provider request id") }
        : {}),
    },
    localReference: { status: "deleted" },
    localAuditRecord: {
      auditId: requireSafeId(value.localAuditRecord.auditId, "local audit id"),
      storagePolicy: "local-redacted-lifecycle-audit",
    },
    storagePolicy: "append-only-redacted-lifecycle-audit",
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationRecord(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation record must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-append"
  ) {
    throw new HttpError(400, "Teaching operation record policy is invalid.");
  }
  return {
    recordId: requireSafeId(value.recordId, "teaching operation record id"),
    operationId: requireSafeId(value.operationId, "teaching operation id"),
    actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
    actionId: requireSafeId(value.actionId, "teaching operation action id"),
    actorId: requireSafeId(value.actorId, "actor id"),
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    ...(value.idempotencyKey
      ? { idempotencyKey: requireSafeId(value.idempotencyKey, "idempotency key") }
      : {}),
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    status: "persisted",
    storagePolicy: "external-redacted-teaching-operation-append",
    redaction: createRedaction(),
    artifacts: arrayOrEmpty(value.artifacts).map(normalizeTeachingOperationArtifact),
    domainProjections: arrayOrEmpty(value.domainProjections).map(
      normalizeTeachingOperationDomainProjection,
    ),
  };
}

function normalizeTeachingOperationDomainProjection(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation domain projection must be an object.");
  }
  const objectId = requireSafeId(value.objectId, "domain object id");
  const objectType = requireSafeId(value.objectType, "domain object type");
  const courseId = requireSafeId(value.courseId, "course id");
  const operationRecordId = requireSafeId(value.operationRecordId, "operation record id");
  const storagePolicy = requireSafeId(value.storagePolicy, "domain projection policy");
  if (!storagePolicy.startsWith("domain-projection-teaching-")) {
    throw new HttpError(400, "Teaching operation domain projection policy is invalid.");
  }

  return {
    ...Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        requireSafeId(key, "domain projection field"),
        normalizeArtifactValue(entry),
      ]),
    ),
    objectId,
    objectType,
    courseId,
    operationRecordId,
    storagePolicy,
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationArtifact(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation artifact must be an object.");
  }
  const kind = requireSafeId(value.kind, "teaching operation artifact kind");
  return {
    kind,
    ...Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "kind")
        .map(([key, entry]) => [requireSafeId(key, "artifact field"), normalizeArtifactValue(entry)]),
    ),
  };
}

function normalizeArtifactValue(value) {
  if (typeof value === "string") {
    if (isAllowedRedactionMetadataString(value)) {
      return value;
    }
    if (/\/Users\/|secret|api[_-]?key|token/i.test(value)) {
      throw new HttpError(400, "Teaching operation artifact contains unsafe text.");
    }
    return value.slice(0, 240);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeArtifactValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        requireSafeId(key, "artifact field"),
        normalizeArtifactValue(entry),
      ]),
    );
  }
  return undefined;
}

function isAllowedRedactionMetadataString(value) {
  return (
    value === "exclude-private-and-secret-fields" ||
    value === "no-secrets-or-local-paths-before-export"
  );
}

function normalizeTeachingOperationAuditEvent(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation audit event must be an object.");
  }
  requireRecord(value.requestSource, "teaching operation audit request source");
  if (
    (value.eventType === "teaching-gradebook-update.released" ||
      value.eventType === "teaching-gradebook-update.release-rolled-back") &&
    value.actorRole === "teacher" &&
    value.authMode === "signed-teacher-session" &&
    value.requestSource.ipAddress === "redacted"
  ) {
    return {
      auditId: requireSafeId(value.auditId, "teaching operation audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: value.eventType,
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeSignedSessionAuditAuthSession(value.authSession) }
        : {}),
      courseId: requireSafeId(value.courseId, "course id"),
      gradebookUpdateId: requireSafeId(value.gradebookUpdateId, "gradebook update id"),
      requestSource: {
        userAgent:
          typeof value.requestSource.userAgent === "string" &&
          !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
            ? value.requestSource.userAgent.slice(0, 160)
            : "redacted",
        ipAddress: "redacted",
      },
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (value.eventType === "teaching-operation.rolled-back") {
    if (
      value.actorRole !== "teacher" ||
      value.authMode !== "signed-teacher-session" ||
      value.requestSource.ipAddress !== "redacted"
    ) {
      throw new HttpError(400, "Teaching operation rollback audit event policy is invalid.");
    }
    return {
      auditId: requireSafeId(value.auditId, "teaching operation audit id"),
      traceId: requireSafeId(value.traceId, "trace id"),
      eventType: "teaching-operation.rolled-back",
      actorId: requireSafeId(value.actorId, "actor id"),
      actorRole: "teacher",
      authMode: "signed-teacher-session",
      ...(value.authSession
        ? { authSession: normalizeSignedSessionAuditAuthSession(value.authSession) }
        : {}),
      courseId: requireSafeId(value.courseId, "course id"),
      targetRecordId: requireSafeId(value.targetRecordId, "target record id"),
      operationId: requireSafeId(value.operationId, "teaching operation id"),
      actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
      actionId: requireSafeId(value.actionId, "teaching operation action id"),
      rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
      requestSource: {
        userAgent:
          typeof value.requestSource.userAgent === "string" &&
          !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
            ? value.requestSource.userAgent.slice(0, 160)
            : "redacted",
        ipAddress: "redacted",
      },
      createdAt: requireIsoDate(value.createdAt, "createdAt"),
      redaction: createRedaction(),
    };
  }
  if (
    value.eventType !== "teaching-operation.persisted" ||
    value.actorRole !== "teacher" ||
    value.authMode !== "signed-teacher-session" ||
    value.requestSource.ipAddress !== "redacted"
  ) {
    throw new HttpError(400, "Teaching operation audit event policy is invalid.");
  }
  return {
    auditId: requireSafeId(value.auditId, "teaching operation audit id"),
    traceId: requireSafeId(value.traceId, "trace id"),
    eventType: "teaching-operation.persisted",
    actorId: requireSafeId(value.actorId, "actor id"),
    actorRole: "teacher",
    authMode: "signed-teacher-session",
    ...(value.authSession
      ? { authSession: normalizeSignedSessionAuditAuthSession(value.authSession) }
      : {}),
    operationId: requireSafeId(value.operationId, "teaching operation id"),
    actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
    actionId: requireSafeId(value.actionId, "teaching operation action id"),
    ...(value.courseId ? { courseId: requireSafeId(value.courseId, "course id") } : {}),
    ...(value.sourceAction ? { sourceAction: requireSafeId(value.sourceAction, "source action") } : {}),
    requestSource: {
      userAgent:
        typeof value.requestSource.userAgent === "string" &&
        !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
          ? value.requestSource.userAgent.slice(0, 160)
          : "redacted",
      ipAddress: "redacted",
    },
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationAuditLedgerEntry(value, teacherId) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation audit ledger entry must be an object.");
  }
  if (
    value.storagePolicy !== "external-redacted-teaching-operation-audit-log" ||
    value.storageWritePolicy !== "external-append-only-audit-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation audit ledger policy is invalid.");
  }
  const auditEvent = normalizeTeachingOperationAuditEvent(value.auditEvent);
  if (auditEvent.actorId !== teacherId) {
    throw new Error("Stored teaching operation audit actor id mismatch.");
  }
  return auditEvent;
}

function normalizeTeachingOperationRollbackRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation rollback request must be an object.");
  }
  if (value.action !== "rollback-teaching-operation-record") {
    throw new HttpError(400, "Unsupported teaching operation rollback action.");
  }
  requireRecord(value.requestSource, "teaching operation rollback request source");
  if (value.requestSource.ipAddress !== "redacted") {
    throw new HttpError(400, "Teaching operation rollback request source is invalid.");
  }
  return {
    courseId: requireSafeId(value.courseId, "course id"),
    rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    requestSource: {
      userAgent:
        typeof value.requestSource.userAgent === "string" &&
        !/\/Users\/|secret|api[_-]?key|token/i.test(value.requestSource.userAgent)
          ? value.requestSource.userAgent.slice(0, 160)
          : "redacted",
      ipAddress: "redacted",
    },
  };
}

function normalizeTeachingOperationBackupRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation backup request must be an object.");
  }
  if (value.action !== "create-teaching-operation-backup") {
    throw new HttpError(400, "Unsupported teaching operation backup action.");
  }
  return {
    requestedBy: requireSafeId(value.requestedBy, "teaching operation backup requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

function normalizeTeachingCourseManagementBackupRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management backup request must be an object.",
    );
  }
  if (value.action !== "create-teaching-course-management-backup") {
    throw new HttpError(400, "Unsupported teaching course management backup action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

function normalizeTeachingCourseManagementRestoreDrillRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management restore drill request must be an object.",
    );
  }
  if (value.action !== "verify-teaching-course-management-backup-restore") {
    throw new HttpError(
      400,
      "Unsupported teaching course management restore drill action.",
    );
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

function normalizeTeachingCourseAssetsBackupRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets backup request must be an object.");
  }
  if (value.action !== "create-teaching-course-assets-backup") {
    throw new HttpError(400, "Unsupported teaching course assets backup action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

function normalizeTeachingCourseAssetsRestoreDrillRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course assets restore drill request must be an object.",
    );
  }
  if (value.action !== "verify-teaching-course-assets-backup-restore") {
    throw new HttpError(400, "Unsupported teaching course assets restore drill action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

function normalizeTeachingOperationRestoreDrillRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation restore drill request must be an object.");
  }
  if (value.action !== "verify-teaching-operation-backup-restore") {
    throw new HttpError(400, "Unsupported teaching operation restore drill action.");
  }
  return {
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching operation restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    traceId: requireSafeId(value.traceId, "trace id"),
  };
}

function normalizeTeachingOperationRollbackLedgerEntry(value, teacherId) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation rollback ledger entry must be an object.");
  }
  if (
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation rollback ledger policy is invalid.");
  }
  const rollback = normalizeTeachingOperationRollbackRecord(value.rollback);
  if (rollback.teacherId !== teacherId) {
    throw new Error("Stored teaching operation rollback teacher id mismatch.");
  }
  return rollback;
}

function normalizeTeachingOperationRollbackRecord(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation rollback record must be an object.");
  }
  if (
    value.action !== "rollback-teaching-operation-record" ||
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation rollback record policy is invalid.");
  }

  return {
    rollbackId: requireSafeId(value.rollbackId, "teaching operation rollback id"),
    action: "rollback-teaching-operation-record",
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    targetRecordId: requireSafeId(value.targetRecordId, "target record id"),
    courseId: requireSafeId(value.courseId, "course id"),
    targetOperationId: requireSafeId(value.targetOperationId, "target operation id"),
    targetActionSlot: requireTeachingOperationActionSlot(value.targetActionSlot),
    targetActionId: requireSafeId(value.targetActionId, "target action id"),
    rollbackReason: requireSafeId(value.rollbackReason, "rollback reason"),
    status: "persisted",
    rolledBackAt: requireIsoDate(value.rolledBackAt, "rolledBackAt"),
    storagePolicy: "external-redacted-teaching-operation-rollback",
    storageWritePolicy: "external-append-only-rollback-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationBackup(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation backup must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.eventType !== "teaching-operation-backup.created" ||
    value.storagePolicy !== "external-redacted-teaching-operation-backup" ||
    value.storageWritePolicy !== "external-atomic-backup-snapshot" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation backup policy is invalid.");
  }
  const snapshot = normalizeTeachingOperationBackupSnapshot(value.snapshot);
  const sourceRecordCounts = normalizeTeachingOperationRecordCounts(
    value.sourceRecordCounts,
  );
  const actualRecordCounts = countTeachingOperationBackupSnapshot(snapshot);
  if (
    sourceRecordCounts.operations !== actualRecordCounts.operations ||
    sourceRecordCounts.auditEvents !== actualRecordCounts.auditEvents ||
    sourceRecordCounts.rollbacks !== actualRecordCounts.rollbacks ||
    sourceRecordCounts.alertNotifications !== actualRecordCounts.alertNotifications
  ) {
    throw new HttpError(400, "Teaching operation backup record counts are invalid.");
  }

  return {
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    backupId: requireSafeId(value.backupId, "teaching operation backup id"),
    status: "persisted",
    eventType: "teaching-operation-backup.created",
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(value.requestedBy, "teaching operation backup requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-operation-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationBackupSnapshot(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation backup snapshot must be an object.");
  }
  return {
    operations: arrayOrEmpty(value.operations).map(normalizeTeachingOperationRecord),
    auditEvents: arrayOrEmpty(value.auditEvents).map(normalizeTeachingOperationAuditEvent),
    rollbacks: arrayOrEmpty(value.rollbacks).map(normalizeTeachingOperationRollbackRecord),
    alertNotifications: arrayOrEmpty(value.alertNotifications).map(
      (notification) => normalizeTeachingOperationAlertNotification(notification),
    ),
  };
}

function normalizeTeachingOperationRecordCounts(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation record counts must be an object.");
  }
  return {
    operations: requireNonNegativeInteger(value.operations, "operation count"),
    auditEvents: requireNonNegativeInteger(value.auditEvents, "audit event count"),
    rollbacks: requireNonNegativeInteger(value.rollbacks, "rollback count"),
    alertNotifications: requireNonNegativeInteger(
      value.alertNotifications,
      "alert notification count",
    ),
  };
}

function normalizeTeachingCourseManagementBackup(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course management backup must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.eventType !== "teaching-course-management-backup.created" ||
    value.storagePolicy !== "external-redacted-teaching-course-management-backup" ||
    value.storageWritePolicy !== "external-atomic-backup-snapshot" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching course management backup policy is invalid.");
  }
  const snapshot = normalizeTeachingCourseManagementBackupSnapshot(value.snapshot);
  const sourceRecordCounts = normalizeTeachingCourseManagementRecordCounts(
    value.sourceRecordCounts,
  );
  const actualRecordCounts = countTeachingCourseManagementBackupSnapshot(snapshot);
  if (
    sourceRecordCounts.courses !== actualRecordCounts.courses ||
    sourceRecordCounts.classes !== actualRecordCounts.classes ||
    sourceRecordCounts.memberships !== actualRecordCounts.memberships ||
    sourceRecordCounts.auditEvents !== actualRecordCounts.auditEvents
  ) {
    throw new HttpError(400, "Teaching course management backup record counts are invalid.");
  }

  return {
    backupId: requireSafeId(value.backupId, "teaching course management backup id"),
    status: "persisted",
    eventType: "teaching-course-management-backup.created",
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-management-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseManagementBackupSnapshot(value) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management backup snapshot must be an object.",
    );
  }
  if (value.storagePolicy !== "external-redacted-teaching-course-management-snapshot") {
    throw new HttpError(
      400,
      "Teaching course management backup snapshot policy is invalid.",
    );
  }
  const database = normalizeTeachingCourseManagementDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseManagementRevision(database);
  return createTeachingCourseManagementSnapshot(database, revision);
}

function normalizeTeachingCourseManagementRecordCounts(value) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management record counts must be an object.",
    );
  }
  return {
    courses: requireNonNegativeInteger(value.courses, "course count"),
    classes: requireNonNegativeInteger(value.classes, "class count"),
    memberships: requireNonNegativeInteger(value.memberships, "membership count"),
    auditEvents: requireNonNegativeInteger(value.auditEvents, "audit event count"),
  };
}

function normalizeTeachingCourseManagementRestoreDrill(value) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching course management restore drill must be an object.",
    );
  }
  if (
    value.status !== "verified" ||
    value.eventType !== "teaching-course-management-backup.restore-drill-verified" ||
    value.storagePolicy !== "external-redacted-teaching-course-management-restore-drill" ||
    value.storageWritePolicy !== "external-append-only-restore-drill-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(
      400,
      "Teaching course management restore drill policy is invalid.",
    );
  }
  return {
    backupId: requireSafeId(value.backupId, "teaching course management backup id"),
    drillId: requireSafeId(
      value.drillId,
      "teaching course management restore drill id",
    ),
    status: "verified",
    eventType: "teaching-course-management-backup.restore-drill-verified",
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course management restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    restoredRecordCounts: normalizeTeachingCourseManagementRecordCounts(
      value.restoredRecordCounts,
    ),
    storagePolicy: "external-redacted-teaching-course-management-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseAssetsBackup(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets backup must be an object.");
  }
  if (
    value.status !== "persisted" ||
    value.eventType !== "teaching-course-assets-backup.created" ||
    value.storagePolicy !== "external-redacted-teaching-course-assets-backup" ||
    value.storageWritePolicy !== "external-atomic-backup-snapshot" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching course assets backup policy is invalid.");
  }
  const snapshot = normalizeTeachingCourseAssetsBackupSnapshot(value.snapshot);
  const sourceRecordCounts = normalizeTeachingCourseAssetsRecordCounts(
    value.sourceRecordCounts,
  );
  const actualRecordCounts = countTeachingCourseAssetsBackupSnapshot(snapshot);
  if (
    sourceRecordCounts.assets !== actualRecordCounts.assets ||
    sourceRecordCounts.auditEvents !== actualRecordCounts.auditEvents
  ) {
    throw new HttpError(400, "Teaching course assets backup record counts are invalid.");
  }

  return {
    backupId: requireSafeId(value.backupId, "teaching course assets backup id"),
    status: "persisted",
    eventType: "teaching-course-assets-backup.created",
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets backup requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    sourceRecordCounts,
    snapshot,
    storagePolicy: "external-redacted-teaching-course-assets-backup",
    storageWritePolicy: "external-atomic-backup-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingCourseAssetsBackupSnapshot(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets backup snapshot must be an object.");
  }
  if (value.storagePolicy !== "external-redacted-teaching-course-cover-assets") {
    throw new HttpError(
      400,
      "Teaching course assets backup snapshot policy is invalid.",
    );
  }
  const database = normalizeTeachingCourseAssetsDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createTeachingCourseAssetsRevision(database);
  return createTeachingCourseAssetsSnapshot(database, revision);
}

function normalizeTeachingCourseAssetsRecordCounts(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets record counts must be an object.");
  }
  return {
    assets: requireNonNegativeInteger(value.assets, "course asset count"),
    auditEvents: requireNonNegativeInteger(value.auditEvents, "audit event count"),
  };
}

function normalizeTeachingCourseAssetsRestoreDrill(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching course assets restore drill must be an object.");
  }
  if (
    value.status !== "verified" ||
    value.eventType !== "teaching-course-assets-backup.restore-drill-verified" ||
    value.storagePolicy !== "external-redacted-teaching-course-assets-restore-drill" ||
    value.storageWritePolicy !== "external-append-only-restore-drill-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching course assets restore drill policy is invalid.");
  }
  return {
    backupId: requireSafeId(value.backupId, "teaching course assets backup id"),
    drillId: requireSafeId(value.drillId, "teaching course assets restore drill id"),
    status: "verified",
    eventType: "teaching-course-assets-backup.restore-drill-verified",
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching course assets restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    restoredRecordCounts: normalizeTeachingCourseAssetsRecordCounts(
      value.restoredRecordCounts,
    ),
    storagePolicy: "external-redacted-teaching-course-assets-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationRestoreDrill(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation restore drill must be an object.");
  }
  if (
    value.status !== "verified" ||
    value.eventType !== "teaching-operation-backup.restore-drill-verified" ||
    value.storagePolicy !== "external-redacted-teaching-operation-restore-drill" ||
    value.storageWritePolicy !== "external-append-only-restore-drill-log" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation restore drill policy is invalid.");
  }
  return {
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    backupId: requireSafeId(value.backupId, "teaching operation backup id"),
    drillId: requireSafeId(value.drillId, "teaching operation restore drill id"),
    status: "verified",
    eventType: "teaching-operation-backup.restore-drill-verified",
    traceId: requireSafeId(value.traceId, "trace id"),
    requestedBy: requireSafeId(
      value.requestedBy,
      "teaching operation restore drill requester",
    ),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    restoredRecordCounts: normalizeTeachingOperationRecordCounts(
      value.restoredRecordCounts,
    ),
    storagePolicy: "external-redacted-teaching-operation-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeAlertNotificationRequest(value) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Alert notification request must be an object.");
  }
  if (value.action !== "enqueue-teaching-operation-audit-alert-notifications") {
    throw new HttpError(400, "Unsupported alert notification action.");
  }
  return {
    requestedBy: requireSafeId(value.requestedBy, "alert notification requester"),
    requestedAt: value.requestedAt
      ? requireIsoDate(value.requestedAt, "requestedAt")
      : new Date().toISOString(),
  };
}

function normalizeTeachingOperationAlertNotification(value, expectedTeacherId) {
  if (!isRecord(value)) {
    throw new HttpError(400, "Teaching operation alert notification must be an object.");
  }
  if (
    value.eventType !== "teaching-operation-audit-alert-notification" ||
    value.deliveryChannel !== "admin-outbox" ||
    value.deliveryStatus !== "queued" ||
    value.storagePolicy !==
      "external-redacted-teaching-operation-audit-alert-notification-outbox" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(400, "Teaching operation alert notification policy is invalid.");
  }

  const notification = {
    notificationId: requireSafeId(
      value.notificationId,
      "teaching operation alert notification id",
    ),
    eventType: "teaching-operation-audit-alert-notification",
    deliveryChannel: "admin-outbox",
    deliveryStatus: "queued",
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    alertId: requireSafeId(value.alertId, "teaching operation alert id"),
    severity: requireAlertSeverity(value.severity),
    reason: requireTeachingOperationAlertReason(value.reason),
    auditId: requireSafeId(value.auditId, "teaching operation audit id"),
    traceId: requireSafeId(value.traceId, "trace id"),
    actorId: requireSafeId(value.actorId, "actor id"),
    operationId: requireSafeId(value.operationId, "teaching operation id"),
    actionSlot: requireTeachingOperationActionSlot(value.actionSlot),
    actionId: requireSafeId(value.actionId, "teaching operation action id"),
    requestedBy: requireSafeId(value.requestedBy, "alert notification requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    queuedAt: requireIsoDate(value.queuedAt, "queuedAt"),
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-notification-outbox",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
  if (
    expectedTeacherId &&
    (notification.teacherId !== expectedTeacherId ||
      notification.actorId !== expectedTeacherId)
  ) {
    throw new Error("Stored teaching operation alert notification teacher id mismatch.");
  }
  return notification;
}

function normalizeTeachingOperationAlertWebhookDelivery(value) {
  if (!isRecord(value)) {
    throw new HttpError(
      400,
      "Teaching operation alert webhook delivery must be an object.",
    );
  }
  if (
    value.eventType !== "teaching-operation-audit-alert-webhook-delivery" ||
    value.deliveryChannel !== "admin-webhook" ||
    (value.deliveryStatus !== "delivered" && value.deliveryStatus !== "failed") ||
    value.provider !== "configured-admin-alert-webhook" ||
    value.endpoint !== "redacted" ||
    value.storagePolicy !==
      "external-redacted-teaching-operation-audit-alert-webhook-delivery" ||
    value.storageWritePolicy !== "external-append-only-webhook-delivery-ledger" ||
    value.responsibleSession !== "S12"
  ) {
    throw new HttpError(
      400,
      "Teaching operation alert webhook delivery policy is invalid.",
    );
  }

  return {
    deliveryId: requireSafeId(
      value.deliveryId,
      "teaching operation alert webhook delivery id",
    ),
    eventType: "teaching-operation-audit-alert-webhook-delivery",
    deliveryChannel: "admin-webhook",
    deliveryStatus: value.deliveryStatus,
    provider: "configured-admin-alert-webhook",
    endpoint: "redacted",
    teacherId: requireSafeId(value.teacherId, "teacher id"),
    requestedBy: requireSafeId(value.requestedBy, "alert notification requester"),
    requestedAt: requireIsoDate(value.requestedAt, "requestedAt"),
    deliveredAt: requireIsoDate(value.deliveredAt, "deliveredAt"),
    responseStatus: requireNonNegativeInteger(
      value.responseStatus,
      "webhook delivery response status",
    ),
    notificationCount: requireNonNegativeInteger(
      value.notificationCount,
      "webhook delivery notification count",
    ),
    notificationIds: arrayOrEmpty(value.notificationIds).map((notificationId) =>
      requireSafeId(notificationId, "teaching operation alert notification id"),
    ),
    traceIds: arrayOrEmpty(value.traceIds).map((traceId) =>
      requireSafeId(traceId, "trace id"),
    ),
    storagePolicy:
      "external-redacted-teaching-operation-audit-alert-webhook-delivery",
    storageWritePolicy: "external-append-only-webhook-delivery-ledger",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function mergeOwnership(existing, incoming) {
  if (!existing) {
    return incoming;
  }
  if (existing.teacherId !== incoming.teacherId) {
    throw new HttpError(400, "Teacher AI ownership records cannot be merged across teachers.");
  }
  return {
    teacherId: incoming.teacherId,
    courseIds: mergeIdList(existing.courseIds, incoming.courseIds),
    sampleAssets: mergeById(existing.sampleAssets, incoming.sampleAssets, "sampleAssetId"),
    pptAssets: mergeById(existing.pptAssets, incoming.pptAssets, "pptAssetId"),
    clonedVoiceRefs: mergeById(existing.clonedVoiceRefs, incoming.clonedVoiceRefs, "voiceRefId"),
    audioManifests: mergeById(existing.audioManifests, incoming.audioManifests, "audioManifestId"),
  };
}

function mergeIdList(left = [], right = []) {
  return Array.from(new Set([...left, ...right]));
}

function mergeById(left = [], right = [], key) {
  const merged = new Map();
  for (const item of [...left, ...right]) {
    const previous = merged.get(item[key]);
    merged.set(item[key], {
      ...(previous ?? {}),
      ...item,
    });
  }
  return Array.from(merged.values());
}

async function readJsonBody(request) {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    throw new HttpError(400, "Request body is required.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

function isAuthorized(request, accessToken) {
  const header = request.headers.authorization;
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) {
    return false;
  }
  const actual = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(accessToken);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function resolveTeacherOwnershipPath(dataDir, teacherId) {
  const filePath = resolve(dataDir, "teacher-ai-ownership", `${teacherId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveLifecycleAuditPath(dataDir) {
  const filePath = resolve(dataDir, QWEN_VOICE_LIFECYCLE_AUDIT_FILENAME);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingCourseManagementSnapshotPath(dataDir) {
  const filePath = resolve(dataDir, "teaching-course-management", "database.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingCourseAssetsSnapshotPath(dataDir) {
  const filePath = resolve(dataDir, "teaching-course-assets", "database.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingCourseManagementBackupPath(dataDir, backupId) {
  const filePath = resolve(
    dataDir,
    "teaching-course-management-backups",
    `${backupId}.json`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingCourseManagementRestoreDrillLogPath(dataDir) {
  const filePath = resolve(dataDir, "teaching-course-management-restore-drills.jsonl");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingCourseAssetsBackupPath(dataDir, backupId) {
  const filePath = resolve(dataDir, "teaching-course-assets-backups", `${backupId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingCourseAssetsRestoreDrillLogPath(dataDir) {
  const filePath = resolve(dataDir, "teaching-course-assets-restore-drills.jsonl");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingOperationLogPath(dataDir, teacherId) {
  const filePath = resolve(dataDir, "teaching-operations", `${teacherId}.jsonl`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingOperationAuditLogPath(dataDir, teacherId) {
  const filePath = resolve(dataDir, "teaching-operations-audit", `${teacherId}.jsonl`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingOperationAlertNotificationLogPath(dataDir, teacherId) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-alert-notifications",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingOperationAlertWebhookDeliveryLogPath(dataDir, teacherId) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-alert-webhook-deliveries",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

async function handleLangGraphSnapshotRequest({
  request,
  response,
  dataDir,
  kind,
  namespace,
}) {
  const filePath = resolveLangGraphSnapshotPath(dataDir, kind, namespace);

  if (request.method === "GET") {
    const raw = await readFile(filePath, "utf8").catch((error) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (!raw) {
      sendJson(response, 404, {
        error: "LangGraph persistence snapshot not found.",
        redaction: createRedaction(),
      });
      return;
    }
    sendJson(response, 200, JSON.parse(raw));
    return;
  }

  if (request.method === "PUT") {
    const snapshot = normalizeLangGraphSnapshot({
      kind,
      namespace,
      value: await readJsonBody(request),
    });
    await mkdir(resolve(dataDir, "langgraph-persistence", kind), { recursive: true });
    const tempPath = resolve(
      dataDir,
      "langgraph-persistence",
      kind,
      `${namespace}.${randomUUID()}.tmp`,
    );
    ensureWithinBase(dataDir, tempPath);
    await writeFile(tempPath, JSON.stringify(snapshot), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
    sendJson(response, 200, {
      status: "persisted",
      namespace,
      storagePolicy: "external-redacted-langgraph-persistence",
      storageWritePolicy: "external-atomic-langgraph-snapshot",
      responsibleSession: "S12",
      redaction: createRedaction(),
    });
    return;
  }

  sendJson(response, 405, {
    error: "Unsupported LangGraph persistence method.",
    redaction: createRedaction(),
  });
}

function normalizeLangGraphSnapshot({ kind, namespace, value }) {
  requireRecord(value, "LangGraph persistence snapshot");
  const expectedKind = kind === "checkpoints" ? "langgraph-checkpointer" : "langgraph-store";
  if (value.kind !== expectedKind || value.namespace !== namespace) {
    throw new HttpError(400, "LangGraph persistence snapshot contract mismatch.");
  }
  return {
    ...value,
    storagePolicy: "external-redacted-langgraph-persistence",
    storageWritePolicy: "external-atomic-langgraph-snapshot",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function resolveLangGraphSnapshotPath(dataDir, kind, namespace) {
  const filePath = resolve(
    dataDir,
    "langgraph-persistence",
    kind,
    `${namespace}.json`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingOperationRollbackLogPath(dataDir, teacherId) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-rollbacks",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingOperationBackupPath(dataDir, teacherId, backupId) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-backups",
    teacherId,
    `${backupId}.json`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveTeachingOperationRestoreDrillLogPath(dataDir, teacherId) {
  const filePath = resolve(
    dataDir,
    "teaching-operation-restore-drills",
    `${teacherId}.jsonl`,
  );
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function ensureWithinBase(baseDir, targetPath) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved external storage path escapes the configured data directory.");
  }
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueSafeIds(value, label) {
  return Array.from(new Set(arrayOrEmpty(value).map((entry) => requireSafeId(entry, label))));
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw new HttpError(400, `${label} must be an object.`);
  }
}

function requireSafeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}

function requireTrimmedString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value.trim().slice(0, maxLength);
}

function requireInviteCode(value) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) {
    throw new HttpError(400, "Invite code is invalid.");
  }
  return value;
}

function requireSafeUrlPath(value, label) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}

function requireHttpsUrl(value, label) {
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return parsed.toString();
}

function requireSafeModel(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}

function requireSafeLangGraphNamespace(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new HttpError(400, "Invalid LangGraph persistence namespace.");
  }
  return value;
}

function requireSafeRole(value) {
  if (value !== "teacher" && value !== "admin" && value !== "student") {
    throw new HttpError(400, "Invalid actor role.");
  }
  return value;
}

function requireTeachingOperationActionSlot(value) {
  if (value !== "primary" && value !== "secondary") {
    throw new HttpError(400, "Invalid teaching operation action slot.");
  }
  return value;
}

function requireAlertSeverity(value) {
  if (value !== "high") {
    throw new HttpError(400, "Invalid teaching operation alert severity.");
  }
  return value;
}

function requireTeachingOperationAlertReason(value) {
  if (value !== "missing-course-context") {
    throw new HttpError(400, "Invalid teaching operation alert reason.");
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return Number(value);
}

function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function requireIsoDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new HttpError(400, `${label} must be an ISO date.`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function formatTimestampId(value) {
  const iso = requireIsoDate(value, "timestamp");
  return iso
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function createProductionServiceIdentity(config) {
  return {
    status: config.serviceMode === "production" ? "proved" : "not-production",
    serviceMode: config.serviceMode,
    serviceTarget: config.serviceTarget,
    valueRedacted: true,
  };
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
