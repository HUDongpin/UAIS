import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isTeachingOperationId,
  type TeachingOperationId,
} from "@/components/teaching/teaching-operation-data";
import type {
  ExecuteTeachingOperationActionInput,
  ReadTeachingOperationDatabaseInput,
  ReadTeachingOperationExportInput,
  TeachingGradebookReleaseAuditInput,
  TeachingGradebookReleaseProviderReceipt,
  TeachingGradebookReleaseReceipt,
  TeachingGradebookReleaseRollbackProviderReceipt,
  TeachingGradebookReleaseRollbackReceipt,
  TeachingOperationActionDefinition,
  TeachingOperationActionId,
  TeachingOperationActionSlot,
  TeachingOperationArtifact,
  TeachingOperationAuditEvent,
  TeachingOperationAuditStoragePolicy,
  TeachingOperationBackupRestoreReceipt,
  TeachingOperationDatabase,
  TeachingOperationDatabaseBackup,
  TeachingOperationExportManifest,
  TeachingOperationExternalAppendReceipt,
  TeachingOperationGradeReleaseNotificationProjection,
  TeachingOperationGradeReleaseRollbackNotificationProjection,
  TeachingOperationGradebookUpdateProjection,
  TeachingOperationIdempotencyStatus,
  TeachingOperationInviteCodeAllocator,
  TeachingOperationInviteCodeIntent,
  TeachingOperationInviteCodeRecord,
  TeachingOperationOutboxRecord,
  TeachingOperationPersistedAuditEvent,
  TeachingOperationReceipt,
  TeachingOperationRecord,
  TeachingOperationRecordStoragePolicy,
  TeachingOperationRecordStorageWritePolicy,
  TeachingOperationRollbackProjection,
  TeachingOperationRollbackReceipt,
  ValidatedExecuteTeachingOperationActionInput,
} from "./teaching-operations-types";
// Type-only, so the runtime import stays one-directional (the postgres store
// imports this store's normalizer/error at runtime; this store reaches the
// postgres store through a dynamic import) and no module cycle is created.
import type { TeachingOperationRepository } from "./teaching-operations-postgres-store";
import { drawUnusedInviteCode } from "./invite-code-allocator";
import { resolveTeachingOperationDataDir } from "./teaching-operation-data-dir";
import { actionDefinitions } from "./teaching-operations-action-catalog";
import {
  readTeachingKnowledgeResourceRegistration,
  type TeachingKnowledgeResourceRegistration,
} from "./teaching-knowledge-resource";
import {
  createAuditEvent,
  createBackupRestoreAuditEvent,
  createGradebookReleaseAuditEvent,
  createReceiptAudit,
  createTeachingOperationRollbackAuditEvent,
} from "./teaching-operations-audit-builders";
import {
  normalizeAuditEvent,
  normalizeExternalTeachingOperationAuditReadbackRecord,
  normalizeRecord,
  normalizeTeachingOperationAuditReadbackDomainProjection,
  normalizeTeachingOperationAuditReadbackEvent,
} from "./teaching-operations-audit-normalizers";
import { createDomainProjections } from "./teaching-operations-domain-projection-builder";
import { createDomainProjectionArtifact } from "./teaching-operations-gradebook-external-handlers";
import { normalizeDomainProjection } from "./teaching-operations-domain-projection-normalizer";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  createTeachingOperationContentionError,
  createTeachingOperationWriteRetry,
  teachingOperationMaxWriteAttempts,
} from "./teaching-operations-write-retry";
import {
  applyPendingTeachingOperationWrite,
  collectAppendedTeachingOperationEntities,
  readTeachingOperationEntityBaseline,
  type PendingTeachingOperationWrite,
} from "./teaching-operations-pending-write";
import {
  createIdempotentRecordId,
  createRecordId,
  formatTimestampId,
} from "./teaching-operations-record-ids";
import {
  normalizeExportManifest,
  normalizeInviteCode,
  normalizeOutboxRecord,
} from "./teaching-operations-record-normalizers";
import {
  normalizeExternalAppendReceipt,
  normalizeTeachingGradebookReleaseProviderReceipt,
  normalizeTeachingGradebookReleaseRollbackProviderReceipt,
} from "./teaching-operations-receipt-normalizers";
import {
  createRedaction,
  isRecord,
  isTeachingOperationProductionDatabaseAdapterEvidence,
  isTeachingOperationProductionRuntime,
  requireIsoDate,
  requireSafeId,
} from "./teaching-operations-guards";

// Re-exported so existing consumers importing from this store keep working after
// these were extracted to their own modules (Phase 3 decomposition).
export { resolveTeachingOperationDataDir };
export { TeachingOperationStoreError };
// Re-exported (now defined in the guards module) so the audit routes and other
// route consumers keep importing these from the store unchanged.
export {
  isTeachingOperationProductionDatabaseAdapterEvidence,
  isTeachingOperationProductionRuntime,
};
// Re-exported so the audit route keeps importing these from the store after the
// audit/record normalizers moved to teaching-operations-audit-normalizers.ts.
export {
  normalizeExternalTeachingOperationAuditReadbackRecord,
  normalizeTeachingOperationAuditReadbackDomainProjection,
  normalizeTeachingOperationAuditReadbackEvent,
};
// All shared domain types now live in teaching-operations-types.ts; re-export them
// so existing consumers and the extracted helper modules keep importing them from
// the store unchanged (Phase 3 decomposition).
export type * from "./teaching-operations-types";
// External-storage adapter factories now live in the external-adapters module;
// re-exported so route consumers keep importing them from the store unchanged.
export {
  createUaisTeachingOperationExternalAppendAdapter,
  createUaisTeachingOperationExternalAuditReadAdapter,
  createUaisTeachingOperationExternalRollbackAdapter,
} from "./teaching-operations-external-adapters";
// The append-only gradebook release/rollback pair moved to its own module when
// the guarded snapshot writes grew; re-exported so the routes keep importing
// them from the store unchanged.
export {
  releaseExternalTeachingGradebookUpdate,
  rollbackExternalTeachingGradebookRelease,
} from "./teaching-operations-gradebook-external-handlers";

const localTeachingOperationWriteQueues = new Map<string, Promise<void>>();

export async function executeTeachingOperationAction(
  input: ExecuteTeachingOperationActionInput,
): Promise<TeachingOperationReceipt> {
  if (!isTeachingOperationId(input.operationId)) {
    throw new TeachingOperationStoreError(400, "Unsupported teaching operation.");
  }
  if (input.actionSlot !== "primary" && input.actionSlot !== "secondary") {
    throw new TeachingOperationStoreError(400, "Unsupported teaching operation action.");
  }

  const operationId = input.operationId;
  const knowledgeResource =
    operationId === "knowledge-base" && input.actionSlot === "secondary"
      ? readTeachingKnowledgeResourceRegistration(input.knowledgeResource)
      : undefined;
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const env = input.env ?? process.env;
  const usingExternalPersistence = Boolean(input.appendExternalTeachingOperation);
  // A resolved managed snapshot repository IS production-grade persistence: the
  // non-external path below reads it with its revision and writes back under
  // that revision through the guarded retry ladders. This gate used to demand
  // the external-append adapter and nothing else, so every authenticated
  // teacher on the database-backed launch posture - the one production runs -
  // got a 503 before any of that ran. What is still refused is the only case
  // the 503 was ever about: a production write that would land on the local
  // JSON file.
  const usingManagedSnapshotPersistence =
    Boolean(input.repository) || usesPostgresOperationSnapshot(env);
  if (
    isTeachingOperationProductionRuntime(env) &&
    !usingExternalPersistence &&
    !usingManagedSnapshotPersistence
  ) {
    throw new TeachingOperationStoreError(
      503,
      "Production teaching operation persistence requires a durable backend, not local JSON storage.",
    );
  }
  const { knowledgeResource: unvalidatedKnowledgeResource, ...inputWithoutKnowledgeResource } =
    input;
  void unvalidatedKnowledgeResource;
  const validatedInput: ValidatedExecuteTeachingOperationActionInput = {
    ...inputWithoutKnowledgeResource,
    operationId,
    ...(knowledgeResource ? { knowledgeResource } : {}),
  };

  if (!usingExternalPersistence) {
    return runWithTeachingOperationLocalWriteLock(dataDir, () =>
      executeValidatedTeachingOperationAction({
        input: validatedInput,
        dataDir,
        usingExternalPersistence,
      }),
    );
  }

  return executeValidatedTeachingOperationAction({
    input: validatedInput,
    dataDir,
    usingExternalPersistence,
  });
}

async function executeValidatedTeachingOperationAction(input: {
  input: ValidatedExecuteTeachingOperationActionInput;
  dataDir: string;
  usingExternalPersistence: boolean;
}): Promise<TeachingOperationReceipt> {
  const { dataDir, usingExternalPersistence } = input;
  // The env travels with the access, so the backend the gate above accepted is
  // the backend this read/write actually uses. Without it the resolution below
  // silently fell back to `process.env`, and a caller naming a managed backend
  // could clear the gate and still write the local file.
  const access = createTeachingOperationSnapshotAccess(
    dataDir,
    input.input.repository,
    input.input.env,
  );
  // The revision-carrying read, so the write below can be guarded. External
  // persistence appends to someone else's log and never replaces this snapshot,
  // so it keeps starting from an empty in-memory database with no revision.
  const snapshot: { database: TeachingOperationDatabase; revision?: string } =
    usingExternalPersistence
      ? { database: createEmptyDatabase() }
      : await loadTeachingOperationSnapshot(access);
  const database = snapshot.database;
  const now = input.input.now ?? new Date();
  const createdAt = now.toISOString();
  if (!input.input.actorId) {
    throw new TeachingOperationStoreError(
      401,
      "Signed teacher actor identity is required.",
    );
  }
  const actorId = requireSafeId(input.input.actorId, "actor id");
  const courseId = input.input.courseId
    ? requireSafeId(input.input.courseId, "course id")
    : undefined;
  const sourceAction = input.input.sourceAction
    ? requireSafeId(input.input.sourceAction, "source action")
    : undefined;
  const idempotencyKey = input.input.idempotencyKey
    ? requireSafeId(input.input.idempotencyKey, "idempotency key")
    : undefined;
  const definition = actionDefinitions[input.input.operationId][input.input.actionSlot];
  const storagePolicy: TeachingOperationRecordStoragePolicy =
    input.input.appendExternalTeachingOperation
      ? "external-redacted-teaching-operation-append"
      : "local-json-teaching-operation-database";
  const storageWritePolicy: TeachingOperationRecordStorageWritePolicy =
    input.input.appendExternalTeachingOperation
      ? "external-append-only-operation-log"
      : "atomic-json-file-replace";
  const auditStoragePolicy: TeachingOperationAuditStoragePolicy =
    input.input.appendExternalTeachingOperation
      ? "external-redacted-teaching-operation-audit-log"
      : "local-json-teaching-operation-audit-log";

  if (idempotencyKey) {
    const existingRecord = database.records.find(
      (record) => record.actorId === actorId && record.idempotencyKey === idempotencyKey,
    );
    if (existingRecord) {
      if (
        !isMatchingIdempotentTeachingOperationRecord(existingRecord, {
          operationId: input.input.operationId,
          actionSlot: input.input.actionSlot,
          courseId,
          sourceAction,
          knowledgeResource: input.input.knowledgeResource,
        })
      ) {
        throw new TeachingOperationStoreError(
          409,
          "Teaching operation idempotency key already exists.",
        );
      }

      return createTeachingOperationReceiptFromRecord({
        record: existingRecord,
        definition,
        storagePolicy,
        storageWritePolicy,
        auditStoragePolicy,
        auditEvent: findPersistedAuditEventForRecord(database.auditEvents, existingRecord),
        idempotencyStatus: "already-persisted",
      });
    }
  }

  const recordId = idempotencyKey
    ? createIdempotentRecordId(actorId, idempotencyKey)
    : createRecordId(input.input.operationId, definition.actionId, now);
  // Read before `createArtifacts`, which is the step that appends invite codes,
  // outbox items and export manifests to the snapshot it is handed. The
  // difference is what a merge-only retry has to carry across.
  const entityBaseline = readTeachingOperationEntityBaseline(database);
  const artifacts = await createArtifacts({
    dataDir,
    database,
    writeLocalFiles: !usingExternalPersistence,
    operationId: input.input.operationId,
    actionSlot: input.input.actionSlot,
    actionId: definition.actionId,
    actorId,
    courseId,
    ...(input.input.targetClassId
      ? { classId: requireSafeId(input.input.targetClassId, "target class id") }
      : {}),
    ...(input.input.allocateInviteCode
      ? { allocateInviteCode: input.input.allocateInviteCode }
      : {}),
    recordId,
    table: definition.table,
    now,
    createdAt,
  });
  const domainProjections = createDomainProjections({
    operationId: input.input.operationId,
    actionSlot: input.input.actionSlot,
    actionId: definition.actionId,
    actorId,
    courseId,
    sourceAction,
    courseSettingsPatch: input.input.courseSettingsPatch,
    knowledgeResource: input.input.knowledgeResource,
    recordId,
    createdAt,
    artifacts,
  });
  const artifactsWithDomainObjects = [
    ...artifacts,
    ...domainProjections.map(createDomainProjectionArtifact),
  ];
  const record: TeachingOperationRecord = {
    recordId,
    operationId: input.input.operationId,
    actionSlot: input.input.actionSlot,
    actionId: definition.actionId,
    actorId,
    ...(courseId ? { courseId } : {}),
    ...(sourceAction ? { sourceAction } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    createdAt,
    status: "persisted",
    storagePolicy: "local-json-teaching-operation-database",
    redaction: createRedaction(),
    artifacts: artifactsWithDomainObjects,
    ...(domainProjections.length > 0 ? { domainProjections } : {}),
  };
  const auditEvent = input.input.audit
    ? createAuditEvent({
        audit: input.input.audit,
        operationId: input.input.operationId,
        actionSlot: input.input.actionSlot,
        actionId: definition.actionId,
        actorId,
        courseId,
        sourceAction,
        createdAt,
        now,
      })
    : undefined;

  database.records.push(record);
  if (auditEvent) {
    database.auditEvents.push(auditEvent);
  }
  database.domainProjections.push(...domainProjections);
  database.updatedAt = createdAt;

  const externalAppend = input.input.appendExternalTeachingOperation
    ? normalizeExternalAppendReceipt(
        await input.input.appendExternalTeachingOperation({
          record: {
            ...record,
            storagePolicy,
          },
          auditEvent,
        }),
        {
          expectedTeacherId: actorId,
          expectedReceiptId: recordId,
        },
      )
    : undefined;

  if (!input.input.appendExternalTeachingOperation) {
    await persistPendingTeachingOperationWrite({
      access,
      database,
      ...(snapshot.revision ? { revision: snapshot.revision } : {}),
      pending: {
        record,
        ...(auditEvent ? { auditEvent } : {}),
        domainProjections,
        ...collectAppendedTeachingOperationEntities(database, entityBaseline),
        updatedAt: createdAt,
      },
    });
  }

  return createTeachingOperationReceiptFromRecord({
    record,
    definition,
    storagePolicy,
    storageWritePolicy,
    auditStoragePolicy,
    externalAppend,
    auditEvent,
    idempotencyStatus: externalAppend?.idempotencyStatus ?? (
      idempotencyKey ? "created" : undefined
    ),
  });
}

function createTeachingOperationReceiptFromRecord(input: {
  record: TeachingOperationRecord;
  definition: TeachingOperationActionDefinition;
  storagePolicy: TeachingOperationRecordStoragePolicy;
  storageWritePolicy: TeachingOperationRecordStorageWritePolicy;
  auditStoragePolicy: TeachingOperationAuditStoragePolicy;
  externalAppend?: TeachingOperationExternalAppendReceipt;
  auditEvent?: TeachingOperationPersistedAuditEvent;
  idempotencyStatus?: TeachingOperationIdempotencyStatus;
}): TeachingOperationReceipt {
  return {
    receiptId: input.record.recordId,
    operationId: input.record.operationId,
    actionSlot: input.record.actionSlot,
    actionId: input.record.actionId,
    actorId: input.record.actorId,
    ...(input.record.courseId ? { courseId: input.record.courseId } : {}),
    ...(input.record.sourceAction ? { sourceAction: input.record.sourceAction } : {}),
    ...(input.record.idempotencyKey ? { idempotencyKey: input.record.idempotencyKey } : {}),
    ...(input.idempotencyStatus ? { idempotencyStatus: input.idempotencyStatus } : {}),
    status: "persisted",
    displayMessage: input.definition.displayMessage,
    artifacts: input.record.artifacts,
    storagePolicy: input.storagePolicy,
    storageWritePolicy: input.storageWritePolicy,
    ...(input.externalAppend ? { externalAppend: input.externalAppend } : {}),
    responsibleSession: "S12",
    createdAt: input.record.createdAt,
    ...(input.auditEvent
      ? { audit: createReceiptAudit(input.auditEvent, input.auditStoragePolicy) }
      : {}),
    redaction: createRedaction(),
  };
}

function isMatchingIdempotentTeachingOperationRecord(
  record: TeachingOperationRecord,
  input: {
    operationId: TeachingOperationId;
    actionSlot: TeachingOperationActionSlot;
    courseId?: string;
    sourceAction?: string;
    knowledgeResource?: TeachingKnowledgeResourceRegistration;
  },
) {
  const baseMatches =
    record.operationId === input.operationId &&
    record.actionSlot === input.actionSlot &&
    (record.courseId ?? "") === (input.courseId ?? "") &&
    (record.sourceAction ?? "") === (input.sourceAction ?? "");
  if (!baseMatches) {
    return false;
  }
  if (input.operationId !== "knowledge-base" || input.actionSlot !== "secondary") {
    return true;
  }

  const projection = record.domainProjections?.find(
    (candidate) => candidate.objectType === "resource-review-item",
  );
  return Boolean(
    projection?.objectType === "resource-review-item" &&
      projection.resourceSource === "teacher-submitted-url" &&
      input.knowledgeResource &&
      projection.title === input.knowledgeResource.title &&
      projection.sourceFingerprint === input.knowledgeResource.sourceFingerprint &&
      projection.rightsBasis === input.knowledgeResource.rightsBasis &&
      projection.visibility === input.knowledgeResource.visibility,
  );
}

function findPersistedAuditEventForRecord(
  auditEvents: TeachingOperationAuditEvent[],
  record: TeachingOperationRecord,
): TeachingOperationPersistedAuditEvent | undefined {
  return auditEvents.find(
    (event): event is TeachingOperationPersistedAuditEvent =>
      event.eventType === "teaching-operation.persisted" &&
      event.actorId === record.actorId &&
      event.operationId === record.operationId &&
      event.actionSlot === record.actionSlot &&
      event.actionId === record.actionId &&
      (event.courseId ?? "") === (record.courseId ?? "") &&
      (event.sourceAction ?? "") === (record.sourceAction ?? "") &&
      event.createdAt === record.createdAt,
  );
}

async function runWithTeachingOperationLocalWriteLock<T>(
  dataDir: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = localTeachingOperationWriteQueues.get(dataDir) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  localTeachingOperationWriteQueues.set(dataDir, queued);

  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    releaseCurrent();
    if (localTeachingOperationWriteQueues.get(dataDir) === queued) {
      localTeachingOperationWriteQueues.delete(dataDir);
    }
  }
}

export async function readTeachingOperationDatabase(
  input: ReadTeachingOperationDatabaseInput = {},
): Promise<TeachingOperationDatabase> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const databasePath = resolveDatabasePath(dataDir);
  const raw = await readFile(databasePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) {
    return createEmptyDatabase();
  }

  return normalizeDatabase(JSON.parse(raw));
}

// Exposed so the Postgres cutover adapter and parity checks normalize a snapshot
// the same way the file reader does (Phase 1 durable-data cutover).
export function normalizeTeachingOperationDatabase(
  value: unknown,
): TeachingOperationDatabase {
  return normalizeDatabase(value);
}

// Phase 1 durable-data cutover — backend-aware snapshot access (the "contract"
// read-switch). When UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND selects Postgres,
// the store's operational reads/writes route through the managed repository;
// otherwise they use the JSON file. This uses a DEDICATED var — not the
// external-append UAIS_TEACHING_OPERATIONS_BACKEND — so it cannot collide with
// the external storage-backend contract (which throws under `postgres`). Unset,
// it is byte-identical to the file path, so existing operations are unchanged.
// The postgres-store is imported dynamically to avoid a static import cycle.
function usesPostgresOperationSnapshot(env: Record<string, string | undefined>) {
  const selector = env.UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND?.trim().toLowerCase();
  return selector === "postgres" || selector === "managed";
}

export type TeachingOperationSnapshotAccessInput = {
  dataDir?: string;
  env?: Record<string, string | undefined>;
  repository?: TeachingOperationRepository;
};

function createTeachingOperationSnapshotAccess(
  dataDir: string,
  repository: TeachingOperationRepository | undefined,
  env?: Record<string, string | undefined>,
): TeachingOperationSnapshotAccessInput {
  return {
    dataDir,
    ...(repository ? { repository } : {}),
    ...(env ? { env } : {}),
  };
}

export async function loadTeachingOperationDatabase(
  input: TeachingOperationSnapshotAccessInput = {},
): Promise<TeachingOperationDatabase> {
  return (await loadTeachingOperationSnapshot(input)).database;
}

// The revision-carrying read. Every read-modify-write flow uses this one and
// hands the revision back to `persistTeachingOperationDatabase`, so a writer that
// read a snapshot another writer has since replaced is told to start over rather
// than overwriting work it never saw. The file backend has no revisions - its
// atomic replace plus the local write lock already serialize writers in one
// process - so it answers without one and the guard below is a no-op there.
export async function loadTeachingOperationSnapshot(
  input: TeachingOperationSnapshotAccessInput = {},
): Promise<{ database: TeachingOperationDatabase; revision?: string }> {
  const repository = await resolveTeachingOperationSnapshotRepository(input);
  if (repository) {
    const snapshot = await repository.read();
    return {
      database: normalizeDatabase(snapshot.database),
      ...(snapshot.revision ? { revision: snapshot.revision } : {}),
    };
  }
  return { database: await readTeachingOperationDatabase({ dataDir: input.dataDir }) };
}

export async function persistTeachingOperationDatabase(
  input: TeachingOperationSnapshotAccessInput & {
    database: TeachingOperationDatabase;
    // Absent means "I read no stored revision", which on the FILE backend is
    // still an unconditional write - that backend has no revisions, and its
    // atomic replace plus the local write lock already serialize writers in one
    // process. On the managed backend it now means "I am the first writer", and
    // a row that exists proves otherwise, so the write is refused rather than
    // replacing a snapshot this caller never read. A caller that means to
    // replace a snapshot it did not derive from - the backup restore - reads the
    // current revision first and names it here.
    expectedRevision?: string;
  },
): Promise<void> {
  const repository = await resolveTeachingOperationSnapshotRepository(input);
  if (repository) {
    await repository.write({
      database: input.database,
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
    });
    return;
  }
  await writeTeachingOperationDatabase({
    dataDir: resolveTeachingOperationDataDir(input.dataDir),
    database: input.database,
  });
}

// One guarded read-modify-write against the operations snapshot: read it with
// its revision, let the caller rebuild it from exactly that read, and write it
// back under that revision. A writer whose snapshot was replaced while it was
// thinking loses the write and starts over from the fresh one, so two teachers
// acting at the same moment no longer end with one of the two updates silently
// gone. `apply` therefore has to be re-runnable: it may only derive a new
// database from the one it is handed, never carry state between attempts.
async function runGuardedTeachingOperationSnapshotWrite<T>(input: {
  access: TeachingOperationSnapshotAccessInput;
  apply: (
    database: TeachingOperationDatabase,
  ) => Promise<{ database: TeachingOperationDatabase; result: T }>;
}): Promise<T> {
  const writeRetry = createTeachingOperationWriteRetry();
  for (let attempt = 0; attempt < teachingOperationMaxWriteAttempts; attempt += 1) {
    const snapshot = await loadTeachingOperationSnapshot(input.access);
    const applied = await input.apply(snapshot.database);
    try {
      await persistTeachingOperationDatabase({
        ...input.access,
        database: applied.database,
        ...(snapshot.revision ? { expectedRevision: snapshot.revision } : {}),
      });
      return applied.result;
    } catch (error) {
      if (await writeRetry.shouldRetry({ attempt, error })) {
        continue;
      }
      // A conflict that survives the ladder is exhausted contention, not a
      // caller mistake: answer with the structured 409 rather than passing the
      // backend's own revision-mismatch prose through.
      throw writeRetry.isConflict(error) ? createTeachingOperationContentionError() : error;
    }
  }

  throw createTeachingOperationContentionError();
}

// The same guard for the one flow that cannot re-run its body.
//
// Executing an action writes an export-manifest file and allocates an invite
// code inside `createArtifacts`, before the snapshot is persisted, and the
// receipt the teacher receives names both. Handing that body to
// `runGuardedTeachingOperationSnapshotWrite` would re-create the file and burn a
// second code on every lost race, which is why this write had no guard at all
// and could overwrite a concurrent teacher's action outright.
//
// A lost race therefore re-reads the fresh snapshot and re-applies only the
// values that were already built - no artifact is created twice, no code is
// allocated twice - and retries the merge. Exhaustion answers with the same
// structured 409 the other flows use.
async function persistPendingTeachingOperationWrite(input: {
  access: TeachingOperationSnapshotAccessInput;
  database: TeachingOperationDatabase;
  revision?: string;
  pending: PendingTeachingOperationWrite;
}): Promise<void> {
  const writeRetry = createTeachingOperationWriteRetry();
  let database = input.database;
  let revision = input.revision;
  for (let attempt = 0; attempt < teachingOperationMaxWriteAttempts; attempt += 1) {
    try {
      await persistTeachingOperationDatabase({
        ...input.access,
        database,
        ...(revision ? { expectedRevision: revision } : {}),
      });
      return;
    } catch (error) {
      if (!(await writeRetry.shouldRetry({ attempt, error }))) {
        throw writeRetry.isConflict(error) ? createTeachingOperationContentionError() : error;
      }
      const snapshot = await loadTeachingOperationSnapshot(input.access);
      database = applyPendingTeachingOperationWrite(snapshot.database, input.pending);
      revision = snapshot.revision;
    }
  }

  throw createTeachingOperationContentionError();
}

// The managed repository is resolved once per call rather than held, so an env
// change between requests still takes effect. `repository` is the injection seam
// the durable-backend tests use to exercise contention without a live Postgres;
// unset, resolution is exactly the env switch it always was.
async function resolveTeachingOperationSnapshotRepository(
  input: TeachingOperationSnapshotAccessInput,
): Promise<TeachingOperationRepository | undefined> {
  if (input.repository) {
    return input.repository;
  }
  const env = input.env ?? process.env;
  if (!usesPostgresOperationSnapshot(env)) {
    return undefined;
  }
  const { createUaisTeachingOperationPostgresRepository } = await import(
    "./teaching-operations-postgres-store"
  );
  return createUaisTeachingOperationPostgresRepository({ env });
}

export async function readTeachingOperationDatabaseBackup(input: {
  dataDir?: string;
  backupId: string;
}): Promise<TeachingOperationDatabaseBackup | undefined> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const filePath = resolveDatabaseBackupPath(dataDir, input.backupId);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) {
    return undefined;
  }

  return normalizeDatabaseBackup(JSON.parse(raw));
}

export function collectTeachingOperationDatabaseCourseIds(
  database: TeachingOperationDatabase,
) {
  const courseIds = new Set<string>();
  const addCourseId = (courseId: string | undefined) => {
    if (courseId) {
      courseIds.add(requireSafeId(courseId, "course id"));
    }
  };

  for (const record of database.records) addCourseId(record.courseId);
  for (const projection of database.domainProjections) addCourseId(projection.courseId);
  for (const inviteCode of database.inviteCodes) addCourseId(inviteCode.courseId);
  for (const outboxItem of database.outbox) addCourseId(outboxItem.courseId);
  for (const manifest of database.exportManifests) addCourseId(manifest.courseId);

  return [...courseIds].sort();
}

export async function readTeachingGradebookUpdate(input: {
  dataDir?: string;
  objectId: string;
}): Promise<TeachingOperationGradebookUpdateProjection | undefined> {
  const database = await loadTeachingOperationDatabase({ dataDir: input.dataDir });
  const objectId = requireSafeId(input.objectId, "gradebook update id");
  const projection = database.domainProjections.find(
    (item): item is TeachingOperationGradebookUpdateProjection =>
      item.objectType === "gradebook-update" && item.objectId === objectId,
  );
  return projection;
}

export async function restoreTeachingOperationDatabaseBackup(input: {
  dataDir?: string;
  // Same seam its sibling `rollbackTeachingOperationRecord` already carries.
  // The route resolves the backend from the environment; naming a repository
  // lets the snapshot half of a restore be exercised without one.
  repository?: TeachingOperationRepository;
  backupId: string;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  now?: Date;
}): Promise<{
  receipt: TeachingOperationBackupRestoreReceipt;
  database: TeachingOperationDatabase;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  return runWithTeachingOperationLocalWriteLock(dataDir, async () => {
    const backupId = requireSafeId(input.backupId, "backup id");
    const backup = await readTeachingOperationDatabaseBackup({ dataDir, backupId });
    if (!backup) {
      throw new TeachingOperationStoreError(404, "Teaching operation backup was not found.");
    }

    const actorId = requireSafeId(input.actorId, "actor id");
    const now = input.now ?? new Date();
    const restoredAt = now.toISOString();
    const impactedCourseIds = collectTeachingOperationDatabaseCourseIds(backup.database);
    const auditEvent = createBackupRestoreAuditEvent({
      audit: input.audit,
      actorId,
      backupId,
      impactedCourseIds,
      now,
      createdAt: restoredAt,
    });
    const restoredDatabase: TeachingOperationDatabase = {
      ...backup.database,
      updatedAt: restoredAt,
      auditEvents: [...backup.database.auditEvents, auditEvent],
    };
    const receipt: TeachingOperationBackupRestoreReceipt = {
      receiptId: `teaching-operations-backup-restore-${backupId}-${formatTimestampId(now)}`,
      action: "restore-teaching-operations-backup",
      backupId,
      actorId,
      impactedCourseIds,
      traceId: input.audit.traceId,
      status: "persisted",
      storagePolicy: "local-json-teaching-operation-database",
      storageWritePolicy: "atomic-json-file-replace",
      responsibleSession: "S12",
      createdAt: restoredAt,
      redaction: createRedaction(),
    };

    // A restore is the one write that does NOT derive its database from the
    // snapshot it replaces - it comes from a backup file - so it has to name the
    // revision it is displacing explicitly. Without it the managed backend reads
    // this as a first write and refuses. Read as late as possible, so the window
    // between the read and the replace is only this call. The file backend has
    // no revisions and answers `undefined`, which leaves its behaviour exactly
    // as it was.
    const access = createTeachingOperationSnapshotAccess(dataDir, input.repository);
    const current = await loadTeachingOperationSnapshot(access);
    await persistTeachingOperationDatabase({
      ...access,
      database: restoredDatabase,
      ...(current.revision ? { expectedRevision: current.revision } : {}),
    });
    return {
      receipt,
      database: restoredDatabase,
    };
  });
}

export async function rollbackTeachingOperationRecord(input: {
  dataDir?: string;
  repository?: TeachingOperationRepository;
  recordId: string;
  actorId: string;
  rollbackReason: string;
  audit: TeachingGradebookReleaseAuditInput;
  now?: Date;
}): Promise<{
  receipt: TeachingOperationRollbackReceipt;
  database: TeachingOperationDatabase;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const access = createTeachingOperationSnapshotAccess(dataDir, input.repository);
  return runWithTeachingOperationLocalWriteLock(dataDir, () =>
    runGuardedTeachingOperationSnapshotWrite({
      access,
      apply: async (database) => {
        const recordId = requireSafeId(input.recordId, "teaching operation record id");
        const actorId = requireSafeId(input.actorId, "actor id");
        const rollbackReason = requireSafeId(input.rollbackReason, "rollback reason");
        const record = database.records.find((item) => item.recordId === recordId);
        if (!record) {
          throw new TeachingOperationStoreError(
            404,
            "Teaching operation record was not found.",
          );
        }
        if (!record.courseId) {
          throw new TeachingOperationStoreError(
            409,
            "Teaching operation record has no course scope.",
          );
        }
        // Re-checked on every attempt rather than once: the writer this loop
        // lost to may have been the rollback of this very record.
        if (
          database.domainProjections.some(
            (projection) =>
              projection.objectType === "operation-rollback" &&
              projection.targetRecordId === recordId,
          )
        ) {
          throw new TeachingOperationStoreError(
            409,
            "Teaching operation record has already been rolled back.",
          );
        }

        const now = input.now ?? new Date();
        const rolledBackAt = now.toISOString();
        const auditEvent = createTeachingOperationRollbackAuditEvent({
          audit: input.audit,
          actorId,
          record,
          rollbackReason,
          now,
          createdAt: rolledBackAt,
        });
        const rollbackProjection: TeachingOperationRollbackProjection = {
          objectId: `operation-rollback-${recordId}`,
          objectType: "operation-rollback",
          courseId: record.courseId,
          targetRecordId: recordId,
          targetOperationId: record.operationId,
          targetActionSlot: record.actionSlot,
          targetActionId: record.actionId,
          rollbackStatus: "rolled-back",
          rollbackReason,
          rolledBackBy: actorId,
          rolledBackAt,
          storagePolicy: "domain-projection-teaching-operation-rollback",
          redaction: createRedaction(),
        };
        const nextDatabase: TeachingOperationDatabase = {
          ...database,
          updatedAt: rolledBackAt,
          auditEvents: [...database.auditEvents, auditEvent],
          domainProjections: [...database.domainProjections, rollbackProjection],
        };
        const receipt: TeachingOperationRollbackReceipt = {
          receiptId: `teaching-operation-rollback-${recordId}-${formatTimestampId(now)}`,
          action: "rollback-teaching-operation-record",
          actorId,
          courseId: record.courseId,
          targetRecordId: recordId,
          traceId: input.audit.traceId,
          rollbackReason,
          status: "persisted",
          storagePolicy: "local-json-teaching-operation-database",
          storageWritePolicy: "atomic-json-file-replace",
          responsibleSession: "S12",
          createdAt: rolledBackAt,
          redaction: createRedaction(),
        };

        return {
          database: nextDatabase,
          result: { receipt, database: nextDatabase },
        };
      },
    }),
  );
}

export async function releaseTeachingGradebookUpdate(input: {
  dataDir?: string;
  repository?: TeachingOperationRepository;
  objectId: string;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  providerRelease?: TeachingGradebookReleaseProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseNotificationProjection;
  receipt: TeachingGradebookReleaseReceipt;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const access = createTeachingOperationSnapshotAccess(dataDir, input.repository);
  return runGuardedTeachingOperationSnapshotWrite({
    access,
    apply: async (database) => {
      const objectId = requireSafeId(input.objectId, "gradebook update id");
      const actorId = requireSafeId(input.actorId, "actor id");
      const providerRelease = input.providerRelease
        ? normalizeTeachingGradebookReleaseProviderReceipt(input.providerRelease)
        : undefined;
      const projectionIndex = database.domainProjections.findIndex(
        (item) => item.objectType === "gradebook-update" && item.objectId === objectId,
      );
      if (projectionIndex < 0) {
        throw new TeachingOperationStoreError(404, "Gradebook update was not found.");
      }

      const existingProjection = database.domainProjections[projectionIndex];
      if (existingProjection.objectType !== "gradebook-update") {
        throw new TeachingOperationStoreError(500, "Gradebook update projection is invalid.");
      }
      const now = input.now ?? new Date();
      const releasedAt = now.toISOString();
      const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
        ...existingProjection,
        updateStatus: "released",
        releasedBy: existingProjection.releasedBy ?? actorId,
        releasedAt: existingProjection.releasedAt ?? releasedAt,
        ...(providerRelease ?? {}),
      };
      const notification: TeachingOperationGradeReleaseNotificationProjection = {
        objectId: `grade-release-notification-${gradebookUpdate.courseId}`,
        objectType: "grade-release-notification",
        courseId: gradebookUpdate.courseId,
        gradebookUpdateId: gradebookUpdate.objectId,
        queuedBy: actorId,
        notificationStatus: "queued",
        deliveryChannel: "student-grade-release-notification",
        operationRecordId: gradebookUpdate.operationRecordId,
        ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
        deliveryPolicy: "teacher-confirmed-grade-release-before-student-notification",
        queuedAt: releasedAt,
        storagePolicy: "domain-projection-teaching-grade-release-notification",
        redaction: createRedaction(),
      };
      const receipt: TeachingGradebookReleaseReceipt = {
        receiptId: `gradebook-release-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
        action: "release-gradebook-update",
        actorId,
        courseId: gradebookUpdate.courseId,
        gradebookUpdateId: gradebookUpdate.objectId,
        traceId: input.audit.traceId,
        status: "persisted",
        ...(providerRelease ?? {}),
        storagePolicy: "local-json-teaching-operation-database",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
        createdAt: releasedAt,
        redaction: createRedaction(),
      };
      const auditEvent = createGradebookReleaseAuditEvent({
        audit: input.audit,
        actorId,
        courseId: gradebookUpdate.courseId,
        gradebookUpdateId: gradebookUpdate.objectId,
        now,
        createdAt: releasedAt,
      });
      const notificationIndex = database.domainProjections.findIndex(
        (item) => item.objectType === "grade-release-notification" && item.objectId === notification.objectId,
      );

      database.domainProjections[projectionIndex] = gradebookUpdate;
      if (notificationIndex >= 0) {
        database.domainProjections[notificationIndex] = notification;
      } else {
        database.domainProjections.push(notification);
      }
      database.auditEvents.push(auditEvent);
      database.updatedAt = releasedAt;
      return {
        database,
        result: { gradebookUpdate, notification, receipt },
      };
    },
  });
}

export async function rollbackTeachingGradebookRelease(input: {
  dataDir?: string;
  repository?: TeachingOperationRepository;
  objectId: string;
  actorId: string;
  audit: TeachingGradebookReleaseAuditInput;
  providerRollback?: TeachingGradebookReleaseRollbackProviderReceipt;
  now?: Date;
}): Promise<{
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  notification: TeachingOperationGradeReleaseRollbackNotificationProjection;
  receipt: TeachingGradebookReleaseRollbackReceipt;
}> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const access = createTeachingOperationSnapshotAccess(dataDir, input.repository);
  return runGuardedTeachingOperationSnapshotWrite({
    access,
    apply: async (database) => {
      const objectId = requireSafeId(input.objectId, "gradebook update id");
      const actorId = requireSafeId(input.actorId, "actor id");
      const projectionIndex = database.domainProjections.findIndex(
        (item) => item.objectType === "gradebook-update" && item.objectId === objectId,
      );
      if (projectionIndex < 0) {
        throw new TeachingOperationStoreError(404, "Gradebook update was not found.");
      }

      const existingProjection = database.domainProjections[projectionIndex];
      if (existingProjection.objectType !== "gradebook-update") {
        throw new TeachingOperationStoreError(500, "Gradebook update projection is invalid.");
      }
      if (existingProjection.updateStatus !== "released") {
        throw new TeachingOperationStoreError(409, "Gradebook update is not released.");
      }

      const now = input.now ?? new Date();
      const rolledBackAt = now.toISOString();
      const providerRollback = input.providerRollback
        ? normalizeTeachingGradebookReleaseRollbackProviderReceipt(input.providerRollback)
        : undefined;
      const gradebookUpdate: TeachingOperationGradebookUpdateProjection = {
        ...existingProjection,
        updateStatus: "release-rolled-back",
        releaseRolledBackBy: actorId,
        releaseRolledBackAt: rolledBackAt,
        ...(providerRollback ?? {}),
      };
      const notification: TeachingOperationGradeReleaseRollbackNotificationProjection = {
        objectId: `grade-release-rollback-notification-${gradebookUpdate.courseId}`,
        objectType: "grade-release-rollback-notification",
        courseId: gradebookUpdate.courseId,
        gradebookUpdateId: gradebookUpdate.objectId,
        queuedBy: actorId,
        notificationStatus: "queued",
        deliveryChannel: "student-grade-release-rollback-notification",
        operationRecordId: gradebookUpdate.operationRecordId,
        ...(gradebookUpdate.sourceAction ? { sourceAction: gradebookUpdate.sourceAction } : {}),
        deliveryPolicy: "teacher-confirmed-grade-release-rollback-before-student-notification",
        queuedAt: rolledBackAt,
        storagePolicy: "domain-projection-teaching-grade-release-rollback-notification",
        redaction: createRedaction(),
      };
      const receipt: TeachingGradebookReleaseRollbackReceipt = {
        receiptId: `gradebook-release-rollback-${gradebookUpdate.objectId}-${formatTimestampId(now)}`,
        action: "rollback-gradebook-release",
        actorId,
        courseId: gradebookUpdate.courseId,
        gradebookUpdateId: gradebookUpdate.objectId,
        traceId: input.audit.traceId,
        status: "persisted",
        ...(providerRollback ?? {}),
        storagePolicy: "local-json-teaching-operation-database",
        storageWritePolicy: "atomic-json-file-replace",
        responsibleSession: "S12",
        createdAt: rolledBackAt,
        redaction: createRedaction(),
      };
      const auditEvent = createGradebookReleaseAuditEvent({
        audit: input.audit,
        eventType: "teaching-gradebook-update.release-rolled-back",
        actorId,
        courseId: gradebookUpdate.courseId,
        gradebookUpdateId: gradebookUpdate.objectId,
        now,
        createdAt: rolledBackAt,
      });
      const notificationIndex = database.domainProjections.findIndex(
        (item) =>
          item.objectType === "grade-release-rollback-notification" &&
          item.objectId === notification.objectId,
      );

      database.domainProjections[projectionIndex] = gradebookUpdate;
      if (notificationIndex >= 0) {
        database.domainProjections[notificationIndex] = notification;
      } else {
        database.domainProjections.push(notification);
      }
      database.auditEvents.push(auditEvent);
      database.updatedAt = rolledBackAt;
      return {
        database,
        result: { gradebookUpdate, notification, receipt },
      };
    },
  });
}

export async function readTeachingOperationExportManifest(
  input: ReadTeachingOperationExportInput,
): Promise<TeachingOperationExportManifest | undefined> {
  const dataDir = resolveTeachingOperationDataDir(input.dataDir);
  const manifestId = requireSafeId(input.manifestId, "manifest id");
  const filePath = resolveExportManifestPath(dataDir, manifestId);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!raw) {
    return undefined;
  }

  return normalizeExportManifest(JSON.parse(raw));
}

async function createArtifacts(input: {
  dataDir: string;
  database: TeachingOperationDatabase;
  writeLocalFiles: boolean;
  operationId: TeachingOperationId;
  actionSlot: TeachingOperationActionSlot;
  actionId: TeachingOperationActionId;
  actorId: string;
  courseId?: string;
  classId?: string;
  allocateInviteCode?: TeachingOperationInviteCodeAllocator;
  recordId: string;
  table: string;
  now: Date;
  createdAt: string;
}): Promise<TeachingOperationArtifact[]> {
  const databaseRecord: TeachingOperationArtifact = {
    kind: "database-record",
    table: input.table,
    recordId: input.recordId,
  };

  if (input.actionId === "preview-student-view") {
    return [
      databaseRecord,
      {
        kind: "student-preview",
        previewId: `student-preview-${formatTimestampId(input.now)}`,
        previewUrl: `/learning?teacherPreview=1${
          input.courseId ? `&course=${encodeURIComponent(input.courseId)}` : ""
        }`,
      },
    ];
  }

  if (input.actionId === "run-permission-preflight") {
    return [
      databaseRecord,
      {
        kind: "preflight",
        status: "passed",
        checkedPermissions: ["course-bindings", "agent-roles", "student-access"],
      },
    ];
  }

  if (input.actionId === "generate-unit-draft") {
    return [
      databaseRecord,
      {
        kind: "generated-draft",
        artifactId: `unit-draft-${formatTimestampId(input.now)}`,
        status: "ready-for-teacher-review",
      },
    ];
  }

  if (input.actionId === "send-collaboration-invite") {
    const outboxItem: TeachingOperationOutboxRecord = {
      outboxId: `collaboration-invite-${input.actorId}-${formatTimestampId(input.now)}`,
      operationId: "admins",
      channel: "collaboration-invite",
      deliveryStatus: "sent-to-local-outbox",
      ...(input.courseId ? { courseId: input.courseId } : {}),
      actorId: input.actorId,
      createdAt: input.createdAt,
    };
    input.database.outbox.push(outboxItem);
    return [
      databaseRecord,
      {
        kind: "outbox",
        outboxId: outboxItem.outboxId,
        channel: "collaboration-invite",
        deliveryStatus: "sent-to-local-outbox",
      },
    ];
  }

  if (input.actionId === "generate-group-suggestions") {
    return [
      databaseRecord,
      {
        kind: "group-suggestions",
        artifactId: `group-suggestions-${formatTimestampId(input.now)}`,
        status: "ready-for-teacher-review",
      },
    ];
  }

  if (input.actionId === "create-export-manifest") {
    const manifest = createExportManifest(input);
    if (input.writeLocalFiles) {
      await writeExportManifest({ dataDir: input.dataDir, manifest });
    }
    input.database.exportManifests.push(manifest);
    return [
      databaseRecord,
      {
        kind: "export-file",
        manifestId: manifest.manifestId,
        downloadUrl: `/api/teaching/operations/export/${manifest.manifestId}`,
        contentType: "application/json",
      },
    ];
  }

  if (input.actionId === "validate-redaction-scope") {
    return [
      databaseRecord,
      {
        kind: "redaction-check",
        status: "passed",
        checkedScopes: ["student-private-notes", "credentials", "local-paths"],
      },
    ];
  }

  if (input.actionId === "lock-daily-snapshot") {
    return [
      databaseRecord,
      {
        kind: "dashboard-snapshot",
        snapshotId: `daily-snapshot-${formatTimestampId(input.now)}`,
        status: "locked",
      },
    ];
  }

  if (input.actionId === "generate-ai-feedback") {
    return [
      databaseRecord,
      {
        kind: "ai-feedback",
        artifactId: `ai-feedback-${formatTimestampId(input.now)}`,
        status: "ready-for-teacher-review",
      },
    ];
  }

  if (input.actionId === "generate-invite-code") {
    const code = await resolveTeachingOperationInviteCode({ ...input, intent: "generate" });
    if (!code) {
      throw new TeachingOperationStoreError(
        409,
        "Teaching operation invite code capacity is exhausted.",
      );
    }
    const inviteRecord: TeachingOperationInviteCodeRecord = {
      inviteId: `invite-${code}-${formatTimestampId(input.now)}`,
      operationId: "invite-code",
      code,
      status: "generated",
      ...(input.courseId ? { courseId: input.courseId } : {}),
      actorId: input.actorId,
      createdAt: input.createdAt,
    };
    input.database.inviteCodes.push(inviteRecord);
    return [
      databaseRecord,
      {
        kind: "invite-code",
        code,
        status: "generated",
        joinUrl: `/courses?invite=${code}`,
      },
    ];
  }

  if (input.actionId === "publish-invite-code") {
    const code = await resolveTeachingOperationInviteCode({ ...input, intent: "publish" });
    if (!code) {
      // Neither the request nor this course has a code to publish. A receipt
      // that names none is the honest one; the fallback this replaced stamped a
      // constant onto whichever class the request happened to point at.
      return [databaseRecord];
    }
    const inviteRecord: TeachingOperationInviteCodeRecord = {
      inviteId: `invite-published-${code}-${formatTimestampId(input.now)}`,
      operationId: "invite-code",
      code,
      status: "published",
      ...(input.courseId ? { courseId: input.courseId } : {}),
      actorId: input.actorId,
      createdAt: input.createdAt,
    };
    input.database.inviteCodes.push(inviteRecord);
    return [
      databaseRecord,
      {
        kind: "invite-code",
        code,
        status: "published",
        joinUrl: `/courses?invite=${code}`,
      },
    ];
  }

  return [databaseRecord];
}

function createExportManifest(input: {
  operationId: TeachingOperationId;
  actorId: string;
  courseId?: string;
  now: Date;
  createdAt: string;
}): TeachingOperationExportManifest {
  return {
    manifestId: `export-manifest-${input.actorId}-${formatTimestampId(input.now)}`,
    operationId: "data-export",
    ...(input.courseId ? { courseId: input.courseId } : {}),
    actorId: input.actorId,
    createdAt: input.createdAt,
    datasets: ["learning-records", "chat-threads", "grades", "activities"],
    formats: ["json", "csv"],
    redactionScope: {
      studentPrivateNotes: "excluded",
      credentials: "excluded",
      localPaths: "excluded",
    },
    redaction: createRedaction(),
  };
}

async function writeTeachingOperationDatabase(input: {
  dataDir: string;
  database: TeachingOperationDatabase;
}) {
  await mkdir(input.dataDir, { recursive: true });
  const filePath = resolveDatabasePath(input.dataDir);
  const existingRaw = await readFile(filePath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    },
  );
  if (existingRaw) {
    await writeTeachingOperationDatabaseBackup({
      dataDir: input.dataDir,
      database: normalizeDatabase(JSON.parse(existingRaw)),
      createdAt: input.database.updatedAt,
    });
  }
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath,
    fileNamePrefix: "teaching-operations",
    value: input.database,
  });
}

async function writeTeachingOperationDatabaseBackup(input: {
  dataDir: string;
  database: TeachingOperationDatabase;
  createdAt: string;
}) {
  const backupDir = resolve(input.dataDir, "backups");
  ensureWithinBase(input.dataDir, backupDir);
  await mkdir(backupDir, { recursive: true });
  const timestampId = formatTimestampId(new Date(input.createdAt));
  const backupPath = resolve(
    backupDir,
    `teaching-operations-backup-${timestampId}.json`,
  );
  ensureWithinBase(input.dataDir, backupPath);
  const backup: TeachingOperationDatabaseBackup = {
    schemaVersion: "uais-teaching-operations-backup-v1",
    createdAt: input.createdAt,
    sourceFile: "teaching-operations.json",
    reason: "before-atomic-replace",
    responsibleSession: "S12",
    redaction: createRedaction(),
    database: input.database,
  };

  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath: backupPath,
    fileNamePrefix: `teaching-operations-backup-${timestampId}`,
    value: backup,
  });
}

async function writeExportManifest(input: {
  dataDir: string;
  manifest: TeachingOperationExportManifest;
}) {
  const exportsDir = resolve(input.dataDir, "exports");
  ensureWithinBase(input.dataDir, exportsDir);
  await mkdir(exportsDir, { recursive: true });
  const filePath = resolveExportManifestPath(input.dataDir, input.manifest.manifestId);
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath,
    fileNamePrefix: input.manifest.manifestId,
    value: input.manifest,
  });
}

async function writeAtomicJsonFile(input: {
  dataDir: string;
  filePath: string;
  fileNamePrefix: string;
  value: unknown;
}) {
  ensureWithinBase(input.dataDir, input.filePath);
  const targetDir = resolve(input.filePath, "..");
  ensureWithinBase(input.dataDir, targetDir);
  await mkdir(targetDir, { recursive: true });
  const tempPath = resolve(
    targetDir,
    `.${input.fileNamePrefix}.${Date.now()}.${randomUUID()}.tmp`,
  );
  ensureWithinBase(input.dataDir, tempPath);

  try {
    await writeFile(tempPath, JSON.stringify(input.value, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, input.filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function resolveDatabasePath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-operations.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveExportManifestPath(dataDir: string, manifestId: string) {
  const safeManifestId = requireSafeId(manifestId, "manifest id");
  const filePath = resolve(dataDir, "exports", `${safeManifestId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function resolveDatabaseBackupPath(dataDir: string, backupId: string) {
  const safeBackupId = requireSafeId(backupId, "backup id");
  const filePath = resolve(dataDir, "backups", `${safeBackupId}.json`);
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

function createEmptyDatabase(): TeachingOperationDatabase {
  return {
    schemaVersion: "uais-teaching-operations-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    records: [],
    auditEvents: [],
    domainProjections: [],
    inviteCodes: [],
    outbox: [],
    exportManifests: [],
  };
}

function normalizeDatabaseBackup(value: unknown): TeachingOperationDatabaseBackup {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "uais-teaching-operations-backup-v1" ||
    value.sourceFile !== "teaching-operations.json" ||
    value.reason !== "before-atomic-replace" ||
    value.responsibleSession !== "S12"
  ) {
    throw new TeachingOperationStoreError(500, "Teaching operation backup is invalid.");
  }

  return {
    schemaVersion: "uais-teaching-operations-backup-v1",
    createdAt: requireIsoDate(value.createdAt, "createdAt"),
    sourceFile: "teaching-operations.json",
    reason: "before-atomic-replace",
    responsibleSession: "S12",
    redaction: createRedaction(),
    database: normalizeDatabase(value.database),
  };
}

function normalizeDatabase(value: unknown): TeachingOperationDatabase {
  if (!isRecord(value) || value.schemaVersion !== "uais-teaching-operations-v1") {
    throw new TeachingOperationStoreError(500, "Teaching operation database is invalid.");
  }

  return {
    schemaVersion: "uais-teaching-operations-v1",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    records: Array.isArray(value.records)
      ? value.records.map(normalizeRecord)
      : [],
    auditEvents: Array.isArray(value.auditEvents)
      ? value.auditEvents.map(normalizeAuditEvent)
      : [],
    domainProjections: Array.isArray(value.domainProjections)
      ? value.domainProjections.map(normalizeDomainProjection)
      : [],
    inviteCodes: Array.isArray(value.inviteCodes)
      ? value.inviteCodes.map(normalizeInviteCode)
      : [],
    outbox: Array.isArray(value.outbox) ? value.outbox.map(normalizeOutboxRecord) : [],
    exportManifests: Array.isArray(value.exportManifests)
      ? value.exportManifests.map(normalizeExportManifest)
      : [],
  };
}

// Where an invite-code action's code comes from.
//
// The allocator the caller passes is the arbiter: for the route it draws
// against the course-management corpus (the store that owns deployment-wide
// code uniqueness) and, for a publish, names the code the request's own class
// or draft already holds. Only a caller that named no allocator - a direct
// store call - falls back to this snapshot, and even then a generate draws at
// random and a publish stays inside the request's own course.
//
// What is gone is the pair this replaced: a sequential walk from a constant,
// which made every code in the deployment guessable from any one of them, and a
// publish that stamped `inviteCodes.at(-1)` - the last code generated for ANY
// course - onto whichever class the request pointed at.
async function resolveTeachingOperationInviteCode(input: {
  database: TeachingOperationDatabase;
  allocateInviteCode?: TeachingOperationInviteCodeAllocator;
  intent: TeachingOperationInviteCodeIntent;
  actorId: string;
  courseId?: string;
  classId?: string;
}) {
  const allocated = await input.allocateInviteCode?.({
    intent: input.intent,
    actorId: input.actorId,
    ...(input.courseId ? { courseId: input.courseId } : {}),
    ...(input.classId ? { classId: input.classId } : {}),
  });
  if (allocated) {
    return requireInviteCode(allocated);
  }
  if (input.intent === "publish") {
    return findCourseScopedInviteCode(input.database, input.courseId);
  }

  return drawUnusedInviteCode(
    new Set(input.database.inviteCodes.map((inviteCode) => inviteCode.code)),
  );
}

// The newest code this course generated, and only this course. A publish that
// reached past its own course is how one class's code landed on another's.
function findCourseScopedInviteCode(
  database: TeachingOperationDatabase,
  courseId: string | undefined,
) {
  for (let index = database.inviteCodes.length - 1; index >= 0; index -= 1) {
    const inviteCode = database.inviteCodes[index];
    if ((inviteCode.courseId ?? "") === (courseId ?? "")) {
      return inviteCode.code;
    }
  }

  return undefined;
}

function requireInviteCode(value: string) {
  if (!/^\d{8}$/.test(value)) {
    throw new TeachingOperationStoreError(400, "Teaching operation invite code is invalid.");
  }
  return value;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new TeachingOperationStoreError(
      400,
      "Resolved teaching operation path escapes the configured data directory.",
    );
  }
}
