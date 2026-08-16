import {
  createOptimisticWriteRetry,
  snapshotContentionReasonCode,
} from "./optimistic-write-retry";
import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import { isTeachingCourseManagementOptimisticSnapshotConflict } from "./teaching-course-management-helpers";

// Contention policy for the teaching-course-management read-modify-write loops.
//
// Enrolment day is the contended case this exists for: a teacher publishes one
// invite code and a whole class joins inside a minute, every join a
// read-modify-write of the same course row, and every approval another one. A
// single retry - which is what these loops used to allow - is enough for two
// writers and drops the third, so a student's join answers 409 and their seat
// silently does not exist. Five attempts spread by decorrelated jitter cover an
// ordinary class-sized burst; past that the honest answer is that the row is too
// hot for this request, and the caller is told so in a form it can act on.
export const teachingCourseManagementMaxWriteAttempts = 5;

export function createTeachingCourseManagementWriteRetry() {
  return createOptimisticWriteRetry({
    maxAttempts: teachingCourseManagementMaxWriteAttempts,
    isConflict: isTeachingCourseManagementOptimisticSnapshotConflict,
  });
}

// Exhaustion keeps the 409 it always had, and adds the machine-readable half:
// `reasonCode` is stable, so a client can tell "the row was busy, try again"
// apart from "your request was wrong" without parsing English. The prose message
// is unchanged so existing consumers and evidence checks still match.
export function createTeachingCourseManagementContentionError(input?: {
  attempts?: number;
}) {
  return new TeachingCourseManagementStoreError(
    409,
    "Teaching course management snapshot changed; retry required.",
    { attempts: input?.attempts ?? teachingCourseManagementMaxWriteAttempts },
    snapshotContentionReasonCode,
  );
}
