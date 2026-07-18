import {
  normalizeTeachingCourseManagementDatabase,
  readTeachingCourseManagementDatabase,
  type TeachingCourseManagementDatabase,
} from "@/lib/server/teaching-course-management-store";
import { createUaisTeachingCourseManagementPostgresRepository } from "@/lib/server/teaching-course-management-postgres-store";

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

/**
 * Backfill: copy the JSON-file snapshot into managed Postgres, then verify parity.
 * The JSON file is the source of truth and is left untouched (rollback stays safe).
 */
export async function backfillTeachingCourseManagementToPostgres(input: {
  env: Record<string, string | undefined>;
  sourceDataDir?: string;
}): Promise<TeachingCourseManagementCutoverParity> {
  const source = normalizeTeachingCourseManagementDatabase(
    await readTeachingCourseManagementDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createUaisTeachingCourseManagementPostgresRepository({
    env: input.env,
  });
  await repository.write({ database: source });
  return verifyParityAgainstManaged(source, repository);
}

/**
 * Read-only parity gate between the JSON-file snapshot and managed Postgres.
 * Use before switching reads, and after, to confirm the two sources agree.
 */
export async function verifyTeachingCourseManagementParity(input: {
  env: Record<string, string | undefined>;
  sourceDataDir?: string;
}): Promise<TeachingCourseManagementCutoverParity> {
  const source = normalizeTeachingCourseManagementDatabase(
    await readTeachingCourseManagementDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createUaisTeachingCourseManagementPostgresRepository({
    env: input.env,
  });
  return verifyParityAgainstManaged(source, repository);
}

async function verifyParityAgainstManaged(
  source: TeachingCourseManagementDatabase,
  repository: ReturnType<typeof createUaisTeachingCourseManagementPostgresRepository>,
): Promise<TeachingCourseManagementCutoverParity> {
  const managed = await repository.read();
  const managedDatabase = normalizeTeachingCourseManagementDatabase(managed.database);
  const status =
    JSON.stringify(source) === JSON.stringify(managedDatabase) ? "parity" : "mismatch";
  return {
    target: "teaching-course-management-cutover",
    status,
    entityCounts: {
      courses: managedDatabase.courses.length,
      classes: managedDatabase.classes.length,
      memberships: managedDatabase.memberships.length,
      auditEvents: managedDatabase.auditEvents.length,
    },
    managedRevision: managed.revision,
    redaction: {
      records: "counts-only",
      secrets: "omitted",
    },
  };
}
