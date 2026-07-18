// Filesystem persistence + backup/append/rollback/audit-alert operations for the
// external-storage route service (Phase 3 decomposition). The route handlers call
// these; this layer calls only the serialization/guards/paths modules and the
// teaching stores — never the handlers — so the service imports it back with no cycle.



import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { UaisTeacherAiResourceOwnership } from "@/lib/server/ai-resource-grants";
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
  createRedaction,
  formatTimestampId,
  isPositiveInteger,
  isRecord,
  requireSafeId,
} from "./external-storage-route-guards";
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
  normalizeLifecycleAuditEvent,
  normalizeOwnership,
  normalizeTeachingCourseAssetsBackup,
  normalizeTeachingCourseAssetsRestoreDrill,
  normalizeTeachingCourseManagementBackup,
  normalizeTeachingCourseManagementRestoreDrill,
  normalizeTeachingOperationAlertNotification,
  normalizeTeachingOperationAlertWebhookDelivery,
  normalizeTeachingOperationAuditEvent,
  normalizeTeachingOperationAuditLedgerEntry,
  normalizeTeachingOperationBackup,
  normalizeTeachingOperationRecord,
  normalizeTeachingOperationRestoreDrill,
  normalizeTeachingOperationRollbackLedgerEntry,
  normalizeTeachingOperationRollbackRecord,
  type QwenVoiceLifecycleAuditEvent,
} from "./external-storage-serialization";
import type { ExternalStorageRouteConfig } from "./external-storage-route-service";

const teachingOperationAppendWriteQueues = new Map<string, Promise<void>>();

export async function readTeacherOwnership(input: {
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

export async function writeTeacherOwnership(input: {
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

export async function readTeachingCourseManagementSnapshot(dataDir: string) {
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

export async function replaceTeachingCourseManagementSnapshot(input: {
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

export async function readTeachingCourseAssetsSnapshot(dataDir: string) {
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

export async function replaceTeachingCourseAssetsSnapshot(input: {
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


export async function createTeachingCourseManagementBackup(input: {
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

export async function verifyTeachingCourseManagementBackupRestoreDrill(input: {
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

export async function createTeachingCourseAssetsBackup(input: {
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

export async function verifyTeachingCourseAssetsBackupRestoreDrill(input: {
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

export async function writeTeachingCourseManagementBackup(input: {
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

export async function readTeachingCourseManagementBackup(input: {
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

export async function appendTeachingCourseManagementRestoreDrill(input: {
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

export async function writeTeachingCourseAssetsBackup(input: {
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

export async function readTeachingCourseAssetsBackup(input: {
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

export async function appendTeachingCourseAssetsRestoreDrill(input: {
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

export async function appendLifecycleAuditEvent(input: {
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

export async function appendTeachingOperation(input: {
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

export async function runWithTeachingOperationAppendWriteLock<T>(
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

export function areTeachingOperationRecordsEquivalent(
  left: ReturnType<typeof normalizeTeachingOperationRecord> & { appendSequence?: number },
  right: ReturnType<typeof normalizeTeachingOperationRecord> & { appendSequence?: number },
) {
  return (
    JSON.stringify(stripTeachingOperationAppendSequence(left)) ===
    JSON.stringify(stripTeachingOperationAppendSequence(right))
  );
}

export function stripTeachingOperationAppendSequence<T extends { appendSequence?: number }>(
  record: T,
) {
  const rest = { ...record };
  delete rest.appendSequence;
  return rest;
}

export async function createTeachingOperationBackup(input: {
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

export async function rollbackTeachingOperation(input: {
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

export async function verifyTeachingOperationBackupRestoreDrill(input: {
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

export async function findTeachingOperationRecord(input: {
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

export async function listTeachingOperationRecords(dataDir: string, teacherId: string) {
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

export function normalizeTeachingOperationLogEntry(value: unknown, teacherId: string) {
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

export async function writeTeachingOperationBackup(input: {
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

export async function readTeachingOperationBackup(input: {
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

export async function appendTeachingOperationRestoreDrill(input: {
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

export async function appendTeachingOperationRollback(input: {
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

export async function appendTeachingOperationAuditEvent(input: {
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

export async function listLifecycleAuditEvents(dataDir: string) {
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

export async function listTeachingOperationAuditEvents(dataDir: string, teacherId: string) {
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

export async function listTeachingOperationAuditReadback(dataDir: string, teacherId: string) {
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

export async function summarizeTeachingOperationAuditAlerts(
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

export async function enqueueTeachingOperationAlertNotifications(input: {
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

export async function appendTeachingOperationAlertNotifications(input: {
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

export async function deliverTeachingOperationAlertNotifications(input: {
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

export async function appendTeachingOperationAlertWebhookDelivery(input: {
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

export async function listTeachingOperationAlertNotifications(
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

export async function listTeachingOperationRollbackRecords(dataDir: string, teacherId: string) {
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

export function createTeachingOperationAlertNotification(input: {
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

export function createTeachingOperationAlertWebhookDelivery(input: {
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

export function createTeachingOperationRollbackAuditEvent(input: {
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

export function createTeachingOperationBackupReceipt(
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
