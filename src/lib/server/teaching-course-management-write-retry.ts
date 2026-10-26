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
// silently does not exist. Ordinary edits retain five attempts. Actual concurrent
// classroom admission exceeded that ladder, so joins use twelve bounded attempts
// with the same jitter before returning an actionable contention response.
export const teachingCourseManagementMaxWriteAttempts = 5;
export const teachingClassroomJoinMaxWriteAttempts = 12;

export function createTeachingCourseManagementWriteRetry(options: { maxAttempts?: number } = {}) {
  return createOptimisticWriteRetry({
    maxAttempts: options.maxAttempts ?? teachingCourseManagementMaxWriteAttempts,
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
