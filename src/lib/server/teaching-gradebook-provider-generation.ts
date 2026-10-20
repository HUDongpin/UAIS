import { createHash } from "node:crypto";
import type { TeachingOperationGradebookUpdateProjection } from "./teaching-operations-types";

export function gradebookProviderGeneration(update: TeachingOperationGradebookUpdateProjection) {
  // Legacy releases have no generation ID. Freeze their complete release identity
  // so restoring the same old projection cannot create a fresh dispatch identity.
  return createHash("sha256").update(JSON.stringify([
    update.courseId, update.objectId, update.operationRecordId, update.updatedAt,
    update.updateStatus, update.releaseGenerationId ?? null,
    update.providerReleaseId ?? null, update.releasedAt ?? null,
  ])).digest("hex");
}
