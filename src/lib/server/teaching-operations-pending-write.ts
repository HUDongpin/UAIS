import type {
  TeachingOperationAuditEvent,
  TeachingOperationDatabase,
  TeachingOperationDomainProjection,
  TeachingOperationExportManifest,
  TeachingOperationInviteCodeRecord,
  TeachingOperationOutboxRecord,
  TeachingOperationRecord,
} from "./teaching-operations-types";

// The values one executed teaching-operation action adds to the snapshot, held
// apart from the snapshot they were first applied to.
//
// Every other read-modify-write in this store retries by re-running its whole
// `apply` against a fresh snapshot, which is safe because those bodies only
// derive a new database from the one they are handed. Executing an action is
// different: `createArtifacts` WRITES AN EXPORT-MANIFEST FILE to disk and
// ALLOCATES THE NEXT INVITE CODE before the snapshot is persisted, and the
// receipt handed back to the teacher names both. Replaying that body on a lost
// race would write a second manifest file and burn a second code for one
// request - which is why the guard was left off this flow entirely, and why the
// write could silently overwrite a concurrent teacher's action instead.
//
// So the retry here is a MERGE, not a replay: the record, audit event and
// projections that were already built are re-applied onto the fresh snapshot,
// together with the entities `createArtifacts` appended, and nothing is created
// or allocated a second time.
export type PendingTeachingOperationWrite = {
  record: TeachingOperationRecord;
  auditEvent?: TeachingOperationAuditEvent;
  domainProjections: TeachingOperationDomainProjection[];
  // The entities `createArtifacts` appended for this action - at most one of
  // each, and usually none. They travel with the record because the artifact
  // that names them is already inside it.
  //
  // Known and accepted: an invite code allocated from the snapshot this request
  // read can equal one the winner of the race allocated from the same snapshot,
  // so a merged write can leave two records carrying the same code. Re-deriving
  // it from the fresh snapshot is not an option - the code is already in the
  // receipt the teacher is holding, and quietly storing a different one is worse
  // than storing a duplicate. These records are a teacher-workspace log; the
  // codes a student actually joins with live in teaching-course-management,
  // where a unique index arbitrates.
  inviteCodes: TeachingOperationInviteCodeRecord[];
  outbox: TeachingOperationOutboxRecord[];
  exportManifests: TeachingOperationExportManifest[];
  updatedAt: string;
};

// Where the appended-entity lists started, so the append can be read back off
// the snapshot the action mutated rather than threaded out of `createArtifacts`
// through every branch that does not append anything.
export type TeachingOperationEntityBaseline = {
  inviteCodes: number;
  outbox: number;
  exportManifests: number;
};

export function readTeachingOperationEntityBaseline(
  database: TeachingOperationDatabase,
): TeachingOperationEntityBaseline {
  return {
    inviteCodes: database.inviteCodes.length,
    outbox: database.outbox.length,
    exportManifests: database.exportManifests.length,
  };
}

export function collectAppendedTeachingOperationEntities(
  database: TeachingOperationDatabase,
  baseline: TeachingOperationEntityBaseline,
) {
  return {
    inviteCodes: database.inviteCodes.slice(baseline.inviteCodes),
    outbox: database.outbox.slice(baseline.outbox),
    exportManifests: database.exportManifests.slice(baseline.exportManifests),
  };
}

/**
 * Re-applies an already-built action onto a snapshot someone else moved.
 *
 * Append-only, exactly as the first attempt was: the concurrent writer's records,
 * audit events and projections are all still there afterwards, which is the
 * update the unguarded write used to drop.
 *
 * The record id is the idempotence key of the merge. It is deterministic for an
 * idempotent request (`createIdempotentRecordId`), so if the writer that won the
 * race was THIS request arriving twice, the snapshot already carries everything
 * below and re-applying it would duplicate the record, its projections and its
 * invite code. Returning the snapshot untouched makes the retry safe to run any
 * number of times.
 */
export function applyPendingTeachingOperationWrite(
  database: TeachingOperationDatabase,
  pending: PendingTeachingOperationWrite,
): TeachingOperationDatabase {
  if (database.records.some((record) => record.recordId === pending.record.recordId)) {
    return database;
  }

  return {
    ...database,
    updatedAt: pending.updatedAt,
    records: [...database.records, pending.record],
    auditEvents: pending.auditEvent
      ? [...database.auditEvents, pending.auditEvent]
      : database.auditEvents,
    domainProjections: [...database.domainProjections, ...pending.domainProjections],
    inviteCodes: [...database.inviteCodes, ...pending.inviteCodes],
    outbox: [...database.outbox, ...pending.outbox],
    exportManifests: [...database.exportManifests, ...pending.exportManifests],
  };
}
