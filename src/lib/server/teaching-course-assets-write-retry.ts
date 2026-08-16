import {
  createOptimisticWriteRetry,
  snapshotContentionReasonCode,
} from "./optimistic-write-retry";
import {
  TeachingCourseAssetsStoreError,
  isTeachingCourseAssetsOptimisticSnapshotConflict,
} from "./teaching-course-assets-error";

// Contention policy for the teaching-course-cover asset snapshot.
//
// This loop used to allow exactly ONE retry and to `continue` instantly, which
// is the shape the course-management loops were fixed out of: two writers are
// covered, the third is dropped, and because there is no wait between attempts
// the writers that lost re-read in the same millisecond and collide again.
//
// A cover write is not enrolment-day traffic - it follows a provider image
// generation a teacher triggered - but the whole deployment's covers share ONE
// snapshot row, so a teacher preparing a course while a colleague does the same
// is enough to collide. The cost of losing is also unusually high here: the
// provider call has already been paid for and its image already exists, so a
// dropped write throws away work that costs money to redo. Five attempts spread
// by decorrelated jitter, the same policy the other two domains run.
export const teachingCourseAssetsMaxWriteAttempts = 5;

export function createTeachingCourseAssetsWriteRetry() {
  return createOptimisticWriteRetry({
    maxAttempts: teachingCourseAssetsMaxWriteAttempts,
    isConflict: isTeachingCourseAssetsOptimisticSnapshotConflict,
  });
}

// Exhaustion keeps the 409 and the prose the store always answered with, and
// adds the machine-readable half: `reasonCode` is the same stable value the
// course-management and teaching-operations loops use, so one client rule covers
// all three surfaces.
export function createTeachingCourseAssetsContentionError() {
  return new TeachingCourseAssetsStoreError(
    409,
    "Teaching course cover asset snapshot changed; retry required.",
    snapshotContentionReasonCode,
  );
}
