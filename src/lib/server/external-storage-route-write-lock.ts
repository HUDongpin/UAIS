import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { HttpError } from "./external-storage-http-error";
import { ensureWithinBase } from "./external-storage-route-paths";

// The transcript endpoint stores the whole corpus in one JSON snapshot.  A
// rename is atomic, but it does not make the read/check/rename sequence a CAS:
// two independent route processes can both read the same revision and then
// both publish.  `mkdir` is an atomic create on the shared local filesystem,
// so a directory lock closes that gap across processes as well as across
// requests in one process.  We deliberately do not remove an abandoned lock:
// after a crash the bounded wait fails closed instead of risking a writer
// overwriting a snapshot whose owner may still be active.  This lock is scoped
// to this one transcript snapshot and does not serialize other external stores.
const learningChatroomTranscriptsWriteLockMaxWaitMs = 5_000;
const learningChatroomTranscriptsWriteLockRetryDelayMs = 10;

export async function runWithExternalStorageFileWriteLock<T>(
  filePath: string,
  unavailableMessage: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(resolve(filePath, ".."), { recursive: true });
  const lockPath = `${filePath}.write-lock`;
  const deadline = Date.now() + 5_000;
  // The checked snapshot and ledger sequence must remain current through the
  // write, including across independently loaded workers sharing this directory.
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new HttpError(503, unavailableMessage);
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  try {
    return await action();
  } finally {
    // Do not steal abandoned locks: bounded waits fail closed after a crash.
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runWithLearningChatroomTranscriptsWriteLock<T>(
  dataDir: string,
  action: () => Promise<T>,
) {
  const snapshotDir = resolve(dataDir, "learning-chatroom-transcripts");
  ensureWithinBase(dataDir, snapshotDir);
  await mkdir(snapshotDir, { recursive: true });
  const lockPath = resolve(snapshotDir, ".write-lock");
  ensureWithinBase(dataDir, lockPath);
  const deadline = Date.now() + learningChatroomTranscriptsWriteLockMaxWaitMs;

  for (;;) {
    try {
      // Directory creation is the cross-process atomic claim.  Do not use
      // `{ recursive: true }` here: an existing directory must be a conflict.
      await mkdir(lockPath);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new HttpError(
          503,
          "Learning chatroom transcripts snapshot lock is unavailable.",
        );
      }
      await new Promise<void>((resolveDelay) => {
        setTimeout(resolveDelay, learningChatroomTranscriptsWriteLockRetryDelayMs);
      });
    }
  }

  try {
    return await action();
  } finally {
    // The lock directory is intentionally empty, and force makes cleanup
    // idempotent if a test harness or process supervisor already removed it.
    await rm(lockPath, { force: true, recursive: true }).catch(() => undefined);
  }
}
