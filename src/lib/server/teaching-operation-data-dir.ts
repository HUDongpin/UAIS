import { join, resolve } from "node:path";
import { cwd } from "node:process";

// Resolves the on-disk directory for the teaching-operations JSON store.
// Extracted from `teaching-operations-store.ts` (Phase 3 decomposition) so the
// store and its route consumers share one definition; behavior is pinned by
// `tests/teaching-operation-data-dir.test.ts`.
export function resolveTeachingOperationDataDir(configuredDataDir?: string) {
  return configuredDataDir?.trim()
    ? resolve(/*turbopackIgnore: true*/ configuredDataDir)
    : join(
        /*turbopackIgnore: true*/ cwd(),
        ".tmp",
        "uais-teaching-operations-db",
      );
}
