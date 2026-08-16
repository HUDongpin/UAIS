import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import {
  createEmptyDatabase,
  normalizeTeachingCourseManagementDatabase,
} from "./teaching-course-management-database-normalizer";
import { ensureWithinBase, requireSafeId } from "./teaching-course-management-guards";
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
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const filePath = resolveDatabasePath(dataDir);
  const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!raw) {
    return createEmptyDatabase();
  }
  return normalizeTeachingCourseManagementDatabase(JSON.parse(raw));
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

  return {
    database: await readTeachingCourseManagementDatabase({ dataDir: input.dataDir }),
  };
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
}) {
  await mkdir(input.dataDir, { recursive: true });
  const filePath = resolveDatabasePath(input.dataDir);
  await writeAtomicJsonFile({
    dataDir: input.dataDir,
    filePath,
    fileNamePrefix: "teaching-course-management",
    value: input.database,
  });
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
