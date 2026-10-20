import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createEmptyDatabase,
  normalizeTeachingCourseManagementDatabase,
} from "./teaching-course-management-database-normalizer";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  localTeachingCourseManagementStorage,
  resolveDatabasePath,
  resolveTeachingCourseManagementDataDir,
  writeAtomicJsonFile,
} from "./teaching-course-management-io";
import type { TeachingCourseManagementRepository } from "./teaching-course-management-types";

// Unit generation waits on a provider, so the local read and write may be far
// apart. Give draft writers the same snapshot contract as managed repositories,
// without holding a file lock while generating content.
export function createLocalTeachingUnitDraftRepository(input: {
  dataDir: string;
}): TeachingCourseManagementRepository {
  const dataDir = resolveTeachingCourseManagementDataDir(input.dataDir);
  const filePath = resolveDatabasePath(dataDir);
  const lockPath = join(dataDir, ".teaching-unit-draft-write-lock");

  async function readSnapshot() {
    const raw = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    return {
      database: raw === undefined
        ? createEmptyDatabase()
        : normalizeTeachingCourseManagementDatabase(JSON.parse(raw)),
      revision: raw === undefined
        ? "unit-draft-snapshot-absent"
        : `unit-draft-snapshot-${createHash("sha256").update(raw).digest("hex")}`,
    };
  }

  return {
    storage: localTeachingCourseManagementStorage,
    read: readSnapshot,
    async write({ database, expectedRevision }) {
      await mkdir(dataDir, { recursive: true });
      const deadline = Date.now() + 5_000;
      for (;;) {
        try {
          await mkdir(lockPath);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (Date.now() >= deadline) {
            throw new TeachingCourseManagementStoreError(
              503, "Teaching unit draft storage is temporarily unavailable.",
            );
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
      }
      try {
        const current = await readSnapshot();
        if (expectedRevision !== current.revision) {
          throw new TeachingCourseManagementStoreError(
            409, "Teaching course management snapshot changed; retry required.",
            undefined, "snapshot-contention",
          );
        }
        await writeAtomicJsonFile({
          dataDir, filePath, fileNamePrefix: "teaching-course-management", value: database,
        });
      } finally {
        await rm(lockPath, { recursive: true, force: true });
      }
    },
  };
}
