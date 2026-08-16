import { createHash } from "node:crypto";
import { partitionTeachingCourseManagementDatabaseByCourse } from "@/lib/server/teaching-course-management-course-partition";
import {
  normalizeTeachingCourseManagementDatabase,
  readTeachingCourseManagementDatabase,
  type TeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import {
  createUaisTeachingCourseManagementPostgresRepository,
  type TeachingCourseManagementPostgresClientFactory,
} from "@/lib/server/teaching-course-management-postgres-store";

// Phase 1 durable-data cutover for the teaching-course-management entity.
//
// expand -> migrate -> contract:
//  - expand:   the managed Postgres repository already exists behind the store's
//              repository interface (teaching-course-management-postgres-store.ts).
//  - migrate:  backfillTeachingCourseManagementToPostgres() copies the current
//              JSON-file snapshot into Postgres and verifies parity; run it
//              repeatedly until parity holds.
//  - contract: switch reads by setting UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres
//              (the store's resolver then returns the Postgres repository), and
//              roll back by unsetting it (reads return to the JSON file, which
//              backfill never mutates). verifyTeachingCourseManagementParity()
//              is the ongoing dual-source parity gate before/after the switch.
//
// Both halves are written against the PER-COURSE row shape the managed store
// now keeps. A corpus-wide `write()` is no longer expressible - the store
// refuses one outright - and a corpus-wide read merges the rows back in
// snapshot_key order, which is not the order the file corpus lists them in. So
// the backfill partitions and writes course by course, and the parity gate
// compares the partitioned form rather than a byte comparison of the merge.
//
// Results are redacted to entity counts only — no record contents, no secrets.

export type TeachingCourseManagementCutoverParity = {
  target: "teaching-course-management-cutover";
  status: "parity" | "mismatch";
  entityCounts: {
    courses: number;
    classes: number;
    memberships: number;
    auditEvents: number;
  };
  managedRevision: string | undefined;
  redaction: {
    records: "counts-only";
    secrets: "omitted";
  };
};

type TeachingCourseManagementCutoverInput = {
  env: Record<string, string | undefined>;
  sourceDataDir?: string;
  // The store's own test seam, passed straight through. The cutover is the one
  // caller that issues a write per course and re-reads each row's revision, and
  // that sequence is the part a type-checker cannot verify.
  createDatabase?: TeachingCourseManagementPostgresClientFactory;
};

/**
 * Backfill: copy the JSON-file snapshot into managed Postgres, then verify parity.
 * The JSON file is the source of truth and is left untouched (rollback stays safe).
 */
export async function backfillTeachingCourseManagementToPostgres(
  input: TeachingCourseManagementCutoverInput,
): Promise<TeachingCourseManagementCutoverParity> {
  const source = normalizeTeachingCourseManagementDatabase(
    await readTeachingCourseManagementDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createRepository(input);
  // One write per course row, in a deterministic order. Each write re-reads the
  // revision of the row it is about to replace, because the backfill is
  // documented as "run it repeatedly until parity holds": a second run against
  // rows the first run created must update them under their current revision,
  // not present itself as a first writer and be refused. Each write reconciles
  // that course's invite-code claims inside its own transaction, so a code two
  // courses both claim aborts the backfill instead of silently repointing a
  // join.
  for (const partition of partitionTeachingCourseManagementDatabaseByCourse(source)) {
    const managed = await repository.read({ courseId: partition.courseId });
    await repository.write({
      database: partition.database,
      courseId: partition.courseId,
      ...(managed.revision ? { expectedRevision: managed.revision } : {}),
    });
  }
  return verifyParityAgainstManaged(source, repository);
}

/**
 * Read-only parity gate between the JSON-file snapshot and managed Postgres.
 * Use before switching reads, and after, to confirm the two sources agree.
 */
export async function verifyTeachingCourseManagementParity(
  input: TeachingCourseManagementCutoverInput,
): Promise<TeachingCourseManagementCutoverParity> {
  const source = normalizeTeachingCourseManagementDatabase(
    await readTeachingCourseManagementDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createRepository(input);
  return verifyParityAgainstManaged(source, repository);
}

function createRepository(input: TeachingCourseManagementCutoverInput) {
  return createUaisTeachingCourseManagementPostgresRepository({
    env: input.env,
    ...(input.createDatabase ? { createDatabase: input.createDatabase } : {}),
  });
}

async function verifyParityAgainstManaged(
  source: TeachingCourseManagementDatabase,
  repository: ReturnType<typeof createUaisTeachingCourseManagementPostgresRepository>,
): Promise<TeachingCourseManagementCutoverParity> {
  const managed = await repository.read();
  const managedDatabase = normalizeTeachingCourseManagementDatabase(managed.database);
  // Compared per course, not corpus against corpus. The managed read enumerates
  // the rows in snapshot_key order and concatenates their arrays, so a corpus
  // that agrees on every record still serializes differently from the file that
  // seeded it. Cutting both sides back into rows removes the only difference the
  // round trip can introduce, and leaves every real drift - a record added,
  // removed, or changed - reported as a mismatch.
  const status =
    createPartitionFingerprint(source) === createPartitionFingerprint(managedDatabase)
      ? "parity"
      : "mismatch";
  return {
    target: "teaching-course-management-cutover",
    status,
    entityCounts: {
      courses: managedDatabase.courses.length,
      classes: managedDatabase.classes.length,
      memberships: managedDatabase.memberships.length,
      auditEvents: managedDatabase.auditEvents.length,
    },
    managedRevision: await readManagedCorpusRevision(repository, managedDatabase),
    redaction: {
      records: "counts-only",
      secrets: "omitted",
    },
  };
}

function createPartitionFingerprint(database: TeachingCourseManagementDatabase) {
  return JSON.stringify(
    partitionTeachingCourseManagementDatabaseByCourse(database).map((partition) => [
      partition.courseId,
      partition.database,
    ]),
  );
}

// The corpus has no single revision any more - that was the point of the
// re-key - so this digests the rows' own revisions rather than inventing one.
// It moves when any course row moves, which is what an operator comparing two
// runs needs, and it is deliberately NOT a token an optimistic write could be
// guarded by: no row carries it. Digested rather than listed so the result stays
// counts-only - a joined list would put course ids in a redacted report.
async function readManagedCorpusRevision(
  repository: ReturnType<typeof createUaisTeachingCourseManagementPostgresRepository>,
  managedDatabase: TeachingCourseManagementDatabase,
) {
  const revisions: string[] = [];
  for (const partition of partitionTeachingCourseManagementDatabaseByCourse(
    managedDatabase,
  )) {
    const managed = await repository.read({ courseId: partition.courseId });
    if (managed.revision) {
      revisions.push(`${partition.courseId}:${managed.revision}`);
    }
  }
  if (revisions.length === 0) {
    return undefined;
  }
  const digest = createHash("sha256").update(revisions.join("|")).digest("hex").slice(0, 24);
  return `rows-${revisions.length}-${digest}`;
}
