import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createEmptyLearningChatroomShareDatabase,
  normalizeLearningChatroomShareDatabase,
  type LearningChatroomShareDatabase,
} from "@/lib/server/learning-chatroom-share-store";
import { HttpError } from "./external-storage-http-error";
import { createRedaction } from "./external-storage-route-guards";
import {
  ensureWithinBase,
  resolveLearningChatroomSharesSnapshotPath,
} from "./external-storage-route-paths";
import {
  createLearningChatroomSharesRevision,
  createLearningChatroomSharesSnapshot,
} from "./external-storage-serialization";

// Snapshot persistence for the share-links resource. It is a sibling of the
// transcripts pair in `external-storage-route-store.ts` rather than another
// entry in it: that file sits at the 1500-line lint cap, and the same Phase 3
// decomposition that produced the guards/paths/serialization leaves says a new
// resource gets its own leaf instead of pushing the cap.

export async function readLearningChatroomSharesSnapshot(dataDir: string) {
  const filePath = resolveLearningChatroomSharesSnapshotPath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createLearningChatroomSharesSnapshot(
      createEmptyLearningChatroomShareDatabase(),
      "rev-empty",
    );
  }

  const value = JSON.parse(raw) as { database?: unknown; revision?: unknown };
  const database = normalizeLearningChatroomShareDatabase(value.database);
  const revision =
    typeof value.revision === "string" && value.revision.trim()
      ? value.revision
      : createLearningChatroomSharesRevision(database);
  return createLearningChatroomSharesSnapshot(database, revision);
}


export async function replaceLearningChatroomSharesSnapshot(input: {
  dataDir: string;
  expectedRevision: string;
  database: LearningChatroomShareDatabase;
}) {
  const current = await readLearningChatroomSharesSnapshot(input.dataDir);
  if (current.revision !== input.expectedRevision) {
    throw new HttpError(409, "Learning chatroom shares snapshot revision mismatch.");
  }

  const snapshot = createLearningChatroomSharesSnapshot(input.database);
  const snapshotDir = resolve(input.dataDir, "learning-chatroom-shares");
  ensureWithinBase(input.dataDir, snapshotDir);
  await mkdir(snapshotDir, { recursive: true });
  const filePath = resolveLearningChatroomSharesSnapshotPath(input.dataDir);
  const tempPath = resolve(snapshotDir, `.database.${Date.now()}.${randomUUID()}.tmp`);
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
    storagePolicy: "external-redacted-learning-chatroom-shares",
    storageWritePolicy: "external-optimistic-snapshot-replace",
    responsibleSession: "S12" as const,
    redaction: createRedaction(),
  };
}
