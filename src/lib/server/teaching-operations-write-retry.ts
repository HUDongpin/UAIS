import {
  createOptimisticWriteRetry,
  snapshotContentionReasonCode,
} from "./optimistic-write-retry";
import { TeachingOperationStoreError } from "./teaching-operations-error";

// Contention policy for the teaching-operations snapshot flows.
//
// This snapshot is still a single document, so every guarded write contends with
// every other one rather than only with writers of the same course. The writers
// are teachers acting one action at a time - a gradebook release, a rollback, a
// backup restore - not a class of students arriving at once, so the burst is
// small and three attempts cover it. The same jitter applies: two teachers who
// collide must not re-read in the same millisecond.
export const teachingOperationMaxWriteAttempts = 3;

export function isTeachingOperationSnapshotConflict(error: unknown) {
  return error instanceof TeachingOperationStoreError && error.status === 409;
}

export function createTeachingOperationWriteRetry() {
  return createOptimisticWriteRetry({
    maxAttempts: teachingOperationMaxWriteAttempts,
    isConflict: isTeachingOperationSnapshotConflict,
  });
}

// Exhaustion answers 409 with the same stable `reasonCode` the course-management
// loops use, so one client rule covers both surfaces.
export function createTeachingOperationContentionError() {
  return new TeachingOperationStoreError(
    409,
    "Teaching operation snapshot changed; retry required.",
    snapshotContentionReasonCode,
  );
}
