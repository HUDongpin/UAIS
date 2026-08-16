import { TeachingCourseManagementStoreError } from "./teaching-course-management-error";
import {
  createEmptyDatabase,
  normalizeTeachingCourseManagementDatabase,
} from "./teaching-course-management-database-normalizer";
import type { TeachingCourseManagementDatabase } from "@/lib/server/teaching-course-management-types";

// Cutting the course-management envelope down to one course, and sewing the
// courses back together.
//
// The Postgres store keeps ONE ROW PER COURSE, so it needs to reduce a whole
// snapshot to a single course's records before it writes that course's row, and
// to merge the rows back for the readers that legitimately span courses - the
// teacher/student course list, invite-code discovery, the operations exports.
//
// Both directions are written GENERICALLY, over the envelope's own array keys,
// rather than as a hand-listed field map. The envelope carries ~25 record arrays
// and keeps growing; a field list that fell one release behind would silently
// drop a new array out of every per-course row it touched, and nothing would
// fail loudly. Every record in this envelope carries a required `courseId`, so
// "which course owns this record" is answerable for all of them. An array whose
// elements do not carry one is a schema decision that has to be made
// deliberately - a deployment-wide list needs a home of its own, not a silent
// partition into nothing - so it raises here instead.

// The invite-code namespace is the one thing in this resource that is NOT
// per course: a student joins with a bare 8-digit code and no course context,
// and `createClassInvitationCode` allocates against every code in the
// deployment. The Postgres store therefore keeps a small claims table beside the
// course rows; this is the projection that feeds it.
export type TeachingClassInviteCodeClaim = {
  inviteCode: string;
  classId: string;
};

export function selectTeachingCourseManagementCourseDatabase(
  database: TeachingCourseManagementDatabase,
  courseId: string,
): TeachingCourseManagementDatabase {
  const normalized = normalizeTeachingCourseManagementDatabase(database);
  const partitioned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalized)) {
    partitioned[key] = Array.isArray(value)
      ? value.filter((record) => readRecordCourseId(key, record) === courseId)
      : value;
  }
  return partitioned as TeachingCourseManagementDatabase;
}

// Every course the envelope mentions, from any of its record arrays rather than
// from `courses` alone: a corpus can carry a class, a membership or an audit
// event whose course record has not been written yet, and a migration that
// enumerated only `courses` would leave those rows homeless.
//
// Sorted, so the writers and comparisons built on it are deterministic.
export function listTeachingCourseManagementCourseIds(
  database: TeachingCourseManagementDatabase,
): string[] {
  const normalized = normalizeTeachingCourseManagementDatabase(database);
  const courseIds = new Set<string>();
  for (const [key, value] of Object.entries(normalized)) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const record of value) {
      courseIds.add(readRecordCourseId(key, record));
    }
  }
  return [...courseIds].sort();
}

// The whole corpus cut into the rows the Postgres store keeps.
//
// This is the shape a corpus-wide caller has to speak in now that a write is
// per course: the cutover backfill walks it to write row by row, and the parity
// gate compares it instead of the merged corpus, because merging regroups every
// array by snapshot_key and a raw `JSON.stringify` of that reports "mismatch"
// for a corpus that agrees record for record.
export function partitionTeachingCourseManagementDatabaseByCourse(
  database: TeachingCourseManagementDatabase,
): Array<{ courseId: string; database: TeachingCourseManagementDatabase }> {
  const normalized = normalizeTeachingCourseManagementDatabase(database);
  return listTeachingCourseManagementCourseIds(normalized).map((courseId) => ({
    courseId,
    database: selectTeachingCourseManagementCourseDatabase(normalized, courseId),
  }));
}

export function mergeTeachingCourseManagementCourseDatabases(
  rows: unknown[],
): TeachingCourseManagementDatabase {
  const merged: Record<string, unknown> = { ...createEmptyDatabase() };
  let updatedAt = createEmptyDatabase().updatedAt;
  for (const row of rows) {
    const database = normalizeTeachingCourseManagementDatabase(
      (row as { database?: unknown }).database,
    );
    for (const [key, value] of Object.entries(database)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const current = merged[key];
      merged[key] = Array.isArray(current) ? [...current, ...value] : [...value];
    }
    // Every writer stamps the same ISO format, so the newest course write is the
    // corpus timestamp.
    if (database.updatedAt > updatedAt) {
      updatedAt = database.updatedAt;
    }
  }
  merged.updatedAt = updatedAt;
  return merged as TeachingCourseManagementDatabase;
}

// Every invite code one course holds, from all three places the allocator counts
// them: published class codes, unpublished drafts, and the copy a membership
// keeps of the code it joined with. Deduplicated, first writer of a code wins
// the class attribution, and insertion-ordered so the statement it feeds is
// deterministic.
export function selectTeachingClassInviteCodeClaims(
  database: TeachingCourseManagementDatabase,
): TeachingClassInviteCodeClaim[] {
  const claims = new Map<string, string>();
  for (const classItem of database.classes) {
    claims.set(classItem.invitationCode, classItem.classId);
  }
  for (const draft of database.inviteCodeDrafts ?? []) {
    if (!claims.has(draft.inviteCode)) {
      claims.set(draft.inviteCode, draft.classId);
    }
  }
  for (const membership of database.memberships) {
    if (!claims.has(membership.invitationCode)) {
      claims.set(membership.invitationCode, membership.classId);
    }
  }
  return [...claims].map(([inviteCode, classId]) => ({ inviteCode, classId }));
}

function readRecordCourseId(key: string, record: unknown) {
  const courseId =
    typeof record === "object" && record !== null
      ? (record as { courseId?: unknown }).courseId
      : undefined;
  if (typeof courseId !== "string" || !courseId) {
    throw new TeachingCourseManagementStoreError(
      500,
      `Teaching course management "${key}" records are not course-attributed.`,
    );
  }
  return courseId;
}
