import { resolve } from "node:path";
import type { TeachingOperationRepository } from "./teaching-operations-postgres-store";
import { runWithExternalStorageFileWriteLock } from "./external-storage-route-write-lock";

const localTeachingOperationWriteQueues = new Map<string, Promise<void>>();

// File snapshots need a cross-worker transaction lock. Managed snapshots use
// their shared repository CAS and must never require a writable local directory.
export async function runWithTeachingOperationLocalWriteLock<T>(
  dataDir: string,
  action: () => Promise<T>,
  access: { env?: Record<string, string | undefined>; repository?: TeachingOperationRepository } = {},
): Promise<T> {
  if (access.repository || ["managed", "postgres"].includes((access.env ?? process.env).UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND?.trim().toLowerCase() ?? "")) return action();
  const previous = localTeachingOperationWriteQueues.get(dataDir) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  localTeachingOperationWriteQueues.set(dataDir, queued);

  await previous.catch(() => undefined);
  try {
    return await runWithExternalStorageFileWriteLock(
      resolve(dataDir, "teaching-operations.json"), "Teaching operation snapshot lock is unavailable.", action,
    );
  } finally {
    releaseCurrent();
    if (localTeachingOperationWriteQueues.get(dataDir) === queued) {
      localTeachingOperationWriteQueues.delete(dataDir);
    }
  }
}

