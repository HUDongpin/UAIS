import { createHash, randomUUID } from "node:crypto";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import type { TeachingOperationActionId } from "./teaching-operations-store";

// Record-id and timestamp-id generators for the teaching-operations store
// (Phase 3 decomposition). Pure functions depending only on node:crypto; the
// store types are a type-only import, so there is no runtime import cycle.

export function createIdempotentRecordId(actorId: string, idempotencyKey: string) {
  const digest = createHash("sha256")
    .update(actorId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 24);
  return `teaching-operation-idempotent-${digest}`;
}

export function createRecordId(
  operationId: TeachingOperationId,
  actionId: TeachingOperationActionId,
  now: Date,
) {
  return `${operationId}-${actionId}-${formatTimestampId(now)}-${randomUUID().slice(0, 8)}`;
}

export function formatTimestampId(now: Date) {
  const [datePart, timePart = ""] = now.toISOString().split("T");
  return `${datePart.replace(/-/g, "")}-${timePart.slice(0, 8).replace(/:/g, "")}`;
}
