import { createHash, randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { runWithExternalStorageFileWriteLock } from "./external-storage-route-write-lock";
import {
  loadTeachingOperationSnapshot,
  persistTeachingOperationDatabase,
  resolveTeachingOperationDataDir,
} from "./teaching-operations-store";
import { TeachingOperationStoreError } from "./teaching-operations-error";
import {
  createUaisTeachingOperationPostgresRepository,
  isUaisTeachingOperationPostgresSelector,
  type TeachingOperationRepository,
} from "./teaching-operations-postgres-store";
import type { TeachingGradebookReleaseAuditInput, TeachingOperationGradebookUpdateProjection } from "./teaching-operations-types";
import { gradebookProviderGeneration } from "./teaching-gradebook-provider-generation";
import {
  GradebookProviderOperationBlockedError,
  normalizeGradebookProviderOperations,
  type TeachingGradebookProviderOperation,
} from "./teaching-gradebook-provider-operation-types";

type Access = {
  env: Record<string, string | undefined>;
  repository?: TeachingOperationRepository;
  externalStorage?: boolean;
};

function resolveAccess(input: Access) {
  const managed = isUaisTeachingOperationPostgresSelector(input.env.UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND);
  const production = input.env.NODE_ENV === "production" || input.env.VERCEL_ENV === "production" || input.env.UAIS_DEPLOYMENT_ENV === "production";
  if (input.externalStorage || (!input.repository && !managed && production)) {
    throw new TeachingOperationStoreError(503,
      "Gradebook provider dispatch requires a shared atomic operations snapshot. External append cannot safely claim and complete a generation-bound dispatch.",
      "gradebook-provider-claim-storage-unavailable");
  }
  const repository = input.repository ?? (managed ? createUaisTeachingOperationPostgresRepository({
    env: input.env, snapshotKey: "gradebook-provider-operations",
  }) : undefined);
  // A separate namespace survives ordinary writes and backup restores, including
  // restoring a projection whose provider rollback already completed. Never prune
  // completed intents: they remain the duplicate-dispatch barrier for old backups.
  const baseDir = resolveTeachingOperationDataDir(input.env.UAIS_TEACHING_OPERATIONS_DATA_DIR);
  const dataDir = resolve(baseDir, "gradebook-provider-operations");
  return { dataDir, repository, env: {}, baseDir };
}

async function readSnapshot(access: ReturnType<typeof resolveAccess>) {
  const snapshot = await loadTeachingOperationSnapshot(access);
  const exists = snapshot.revision || (!access.repository && await stat(resolve(access.dataDir, "teaching-operations.json")).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  }));
  if (exists && snapshot.database.providerOperations === undefined) {
    throw new TeachingOperationStoreError(503, "Gradebook provider operation evidence is missing from its snapshot.");
  }
  return { ...snapshot, operations: normalizeGradebookProviderOperations(snapshot.database.providerOperations ?? []) };
}

async function mutate<T>(input: Access, apply: (operations: TeachingGradebookProviderOperation[]) => T) {
  const access = resolveAccess(input);
  const write = async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const snapshot = await readSnapshot(access);
      const result = apply(snapshot.operations);
      try {
        await persistTeachingOperationDatabase({
          ...access,
          expectedRevision: snapshot.revision,
          database: { ...snapshot.database, updatedAt: new Date().toISOString(), providerOperations: snapshot.operations },
        });
        if (!access.repository) {
          // Atomic rename alone is not durable acknowledgement. Flush the file,
          // its directory and parent creation before allowing an external send.
          for (const path of [resolve(access.dataDir, "teaching-operations.json"), access.dataDir, access.baseDir]) {
            const handle = await open(path, "r");
            try { await handle.sync(); } finally { await handle.close(); }
          }
        }
        return result;
      } catch (error) {
        // Only a known CAS conflict permits rebuilding the claim. An uncertain
        // acknowledgement (even if its write committed) never authorizes a send.
        if (error instanceof TeachingOperationStoreError && error.status === 409 && attempt < 3) continue;
        throw error;
      }
    }
    throw new TeachingOperationStoreError(503, "Gradebook provider claim is unavailable.");
  };
  return access.repository ? write() : runWithExternalStorageFileWriteLock(
    resolve(access.dataDir, "teaching-operations.json"), "Gradebook provider claim lock is unavailable.", write,
  );
}

export async function readGradebookProviderOperations(input: Access) {
  return (await readSnapshot(resolveAccess(input))).operations;
}

export async function claimGradebookProviderOperation(input: Access & {
  action: TeachingGradebookProviderOperation["action"];
  dispatchMode: TeachingGradebookProviderOperation["dispatchMode"];
  gradebookUpdate: TeachingOperationGradebookUpdateProjection;
  actorId: string;
  traceId: string;
  audit: TeachingGradebookReleaseAuditInput;
  now: Date;
}) {
  const generation = gradebookProviderGeneration(input.gradebookUpdate);
  const operation: TeachingGradebookProviderOperation = {
    operationId: `gradebook-provider-${randomUUID()}`,
    action: input.action,
    dispatchMode: input.dispatchMode,
    objectId: input.gradebookUpdate.objectId,
    courseId: input.gradebookUpdate.courseId,
    actorId: input.actorId,
    traceId: input.traceId,
    actorRole: "teacher",
    authMode: "signed-teacher-session",
    requestSource: { userAgent: input.audit.requestSource.userAgent.slice(0, 400), ipAddress: "redacted" },
    generation,
    releaseGenerationId: input.action === "release" ? randomUUID() : (input.gradebookUpdate.releaseGenerationId ?? generation),
    sourceOperationRecordId: input.gradebookUpdate.operationRecordId,
    ...(input.gradebookUpdate.providerReleaseId ? { providerReleaseId: input.gradebookUpdate.providerReleaseId } : {}),
    payloadHash: createHash("sha256").update(JSON.stringify(input.gradebookUpdate)).digest("hex"),
    phase: "dispatching",
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString(),
  };
  return mutate(input, (operations) => {
    const blocking = operations.find((existing) => existing.objectId === operation.objectId && existing.courseId === operation.courseId &&
      (existing.phase !== "succeeded" || (existing.action === operation.action && existing.generation === generation)));
    if (blocking) throw new GradebookProviderOperationBlockedError(blocking);
    operations.push(operation);
    return operation;
  });
}

export async function updateGradebookProviderOperation(input: Access & {
  operation: TeachingGradebookProviderOperation;
  phase: "reconciliation-required" | "provider-confirmed" | "completion-pending" | "succeeded";
  providerReceiptId?: string;
}) {
  return mutate(input, (operations) => {
    const operation = operations.find((item) => item.operationId === input.operation.operationId);
    if (!operation || operation.generation !== input.operation.generation || operation.payloadHash !== input.operation.payloadHash) {
      throw new TeachingOperationStoreError(503, "Gradebook provider claim ownership is unavailable.");
    }
    if (operation.phase === "succeeded" || (input.phase === "succeeded" && !["provider-confirmed", "completion-pending"].includes(operation.phase)) ||
      (["provider-confirmed", "completion-pending"].includes(input.phase) && operation.phase !== "dispatching")) {
      throw new GradebookProviderOperationBlockedError(operation);
    }
    // A confirmed receipt is stronger evidence than a later local error.
    if (operation.phase !== "provider-confirmed" || input.phase !== "reconciliation-required") operation.phase = input.phase;
    operation.updatedAt = new Date().toISOString();
    if (input.providerReceiptId) operation.providerReceiptId = input.providerReceiptId;
    return operation;
  });
}
