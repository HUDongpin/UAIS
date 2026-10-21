import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import {
  createEmptyDatabase,
  normalizeTeachingCourseManagementDatabase,
} from "./teaching-course-management-database-normalizer";
import { ensureWithinBase, requireSafeId } from "./teaching-course-management-guards";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import type {
  TeachingCourseManagementDatabase,
  TeachingCourseManagementRepository,
  TeachingCourseManagementRepositorySnapshot,
  TeachingCourseManagementStorageDescriptor,
} from "@/lib/server/teaching-course-management-types";

// Persistence IO for the teaching-course-management store (Phase 3
// decomposition): the default local storage descriptor, data-dir/path resolution,
// atomic JSON file writes, and the repository snapshot read/write layer. Cycle-free:
// runtime deps are node:* and the extracted guards + database-normalizer modules;
// store types are type-only.

export const localTeachingCourseManagementStorage: TeachingCourseManagementStorageDescriptor =
  {
    recordStoragePolicy: "local-json-teaching-course-management",
    auditStoragePolicy: "local-json-teaching-course-management-audit-log",
    storageWritePolicy: "atomic-json-file-replace",
  };

export async function readTeachingCourseManagementDatabase(input: {
  dataDir?: string;
}): Promise<TeachingCourseManagementDatabase> {
  return (await readLocalTeachingCourseManagementSnapshot(input)).database;
}

async function readLocalTeachingCourseManagementSnapshot(input: {
  dataDir?: string;
}): Promise<TeachingCourseManagementRepositorySnapshot> {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const filePath = resolveDatabasePath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  return {
    database: raw ? normalizeTeachingCourseManagementDatabase(JSON.parse(raw)) : createEmptyDatabase(),
    revision: raw ? createHash("sha256").update(raw).digest("hex") : "local-snapshot-absent",
  };
}

// `courseId` narrows the call to one course's row on a backend that keeps one -
// see TeachingCourseManagementRepositoryScope. A caller that knows its course
// must pass it on BOTH the read and the write: the revision it reads belongs to
// that course's row, and a write guarded by a revision from somewhere else can
// never apply.
export async function readTeachingCourseManagementSnapshot(input: {
  dataDir?: string;
  repository?: TeachingCourseManagementRepository;
  courseId?: string;
}): Promise<TeachingCourseManagementRepositorySnapshot> {
  if (input.repository) {
    const snapshot = await input.repository.read(
      input.courseId ? { courseId: input.courseId } : undefined,
    );
    return {
      database: normalizeTeachingCourseManagementDatabase(snapshot.database),
      ...(snapshot.revision ? { revision: requireSafeId(snapshot.revision, "revision") } : {}),
    };
  }

  return readLocalTeachingCourseManagementSnapshot({ dataDir: input.dataDir });
}

export async function writeTeachingCourseManagementSnapshot(input: {
  dataDir: string;
  repository?: TeachingCourseManagementRepository;
  database: TeachingCourseManagementDatabase;
  expectedRevision?: string;
  courseId?: string;
}) {
  if (input.repository) {
    await input.repository.write({
      database: normalizeTeachingCourseManagementDatabase(input.database),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
      ...(input.courseId ? { courseId: input.courseId } : {}),
    });
    return;
  }

  await writeTeachingCourseManagementDatabase({
    dataDir: input.dataDir,
    database: input.database,
    expectedRevision: input.expectedRevision,
  });
}

export function resolveTeachingCourseManagementDataDir(configuredDataDir?: string) {
  return configuredDataDir?.trim()
    ? resolve(/*turbopackIgnore: true*/ configuredDataDir)
    : join(
        /*turbopackIgnore: true*/ cwd(),
        ".tmp",
        "uais-teaching-course-management-db",
      );
}

export async function writeTeachingCourseManagementDatabase(input: {
  dataDir: string;
  database: TeachingCourseManagementDatabase;
  expectedRevision?: string;
}) {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  await runWithLocalTeachingCourseManagementWriteLock(dataDir, async () => {
    const current = await readLocalTeachingCourseManagementSnapshot({ dataDir });
    if (input.expectedRevision !== current.revision) {
      throw new TeachingCourseManagementStoreError(
        409, "Teaching course management snapshot changed; retry required.",
        undefined, "snapshot-contention",
      );
    }
    await writeAtomicJsonFile({
      dataDir,
      filePath: resolveDatabasePath(dataDir),
      fileNamePrefix: "teaching-course-management",
      value: input.database,
    });
  });
}

async function runWithLocalTeachingCourseManagementWriteLock<T>(
  dataDir: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const lockPath = resolve(dataDir, ".teaching-course-management-write-lock");
  ensureWithinBase(dataDir, lockPath);
  const deadline = Date.now() + 5_000;
  // Readers may run concurrently; compare and replace must share one lock
  // across processes because every local course lives in this single file.
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new TeachingCourseManagementStoreError(
          503, "Teaching course management snapshot lock is unavailable.",
        );
      }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  try {
    return await action();
  } finally {
    await rm(lockPath, { force: true, recursive: true }).catch(() => undefined);
  }
}

export function resolveDatabasePath(dataDir: string) {
  const filePath = resolve(dataDir, "teaching-course-management.json");
  ensureWithinBase(dataDir, filePath);
  return filePath;
}

export async function writeAtomicJsonFile(input: {
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
