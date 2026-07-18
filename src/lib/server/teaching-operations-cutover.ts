import {
  normalizeTeachingOperationDatabase,
  readTeachingOperationDatabase,
  type TeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeachingOperationPostgresRepository } from "@/lib/server/teaching-operations-postgres-store";

// Phase 1 durable-data cutover for the teaching-operations entity.
//
// expand -> migrate -> contract:
//  - expand:   the managed Postgres repository (teaching-operations-postgres-store.ts)
//              reads/writes a single jsonb snapshot behind an optimistic-concurrency
//              revision, mirroring the course-management adapter.
//  - migrate:  backfillTeachingOperationsToPostgres() copies the JSON-file snapshot
//              into Postgres and verifies parity; verifyTeachingOperationsParity() is
//              the read-only dual-source gate.
//  - contract: reads switch by setting UAIS_TEACHING_OPERATIONS_BACKEND=postgres (see
//              createUaisTeachingOperationRepository) and roll back by unsetting it
//              (the JSON file is never mutated by backfill).
//
// Results are redacted to entity counts only — no record contents, no secrets.

export type TeachingOperationsCutoverParity = {
  target: "teaching-operations-cutover";
  status: "parity" | "mismatch";
  entityCounts: {
    records: number;
    auditEvents: number;
    domainProjections: number;
    inviteCodes: number;
    outbox: number;
    exportManifests: number;
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
export async function backfillTeachingOperationsToPostgres(input: {
  env: Record<string, string | undefined>;
  sourceDataDir?: string;
}): Promise<TeachingOperationsCutoverParity> {
  const source = normalizeTeachingOperationDatabase(
    await readTeachingOperationDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createUaisTeachingOperationPostgresRepository({ env: input.env });
  await repository.write({ database: source });
  return verifyParityAgainstManaged(source, repository);
}

/**
 * Read-only parity gate between the JSON-file snapshot and managed Postgres.
 * Use before switching reads, and after, to confirm the two sources agree.
 */
export async function verifyTeachingOperationsParity(input: {
  env: Record<string, string | undefined>;
  sourceDataDir?: string;
}): Promise<TeachingOperationsCutoverParity> {
  const source = normalizeTeachingOperationDatabase(
    await readTeachingOperationDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createUaisTeachingOperationPostgresRepository({ env: input.env });
  return verifyParityAgainstManaged(source, repository);
}

async function verifyParityAgainstManaged(
  source: TeachingOperationDatabase,
  repository: ReturnType<typeof createUaisTeachingOperationPostgresRepository>,
): Promise<TeachingOperationsCutoverParity> {
  const managed = await repository.read();
  const managedDatabase = normalizeTeachingOperationDatabase(managed.database);
  const status =
    JSON.stringify(source) === JSON.stringify(managedDatabase) ? "parity" : "mismatch";
  return {
    target: "teaching-operations-cutover",
    status,
    entityCounts: {
      records: managedDatabase.records.length,
      auditEvents: managedDatabase.auditEvents.length,
      domainProjections: managedDatabase.domainProjections.length,
      inviteCodes: managedDatabase.inviteCodes.length,
      outbox: managedDatabase.outbox.length,
      exportManifests: managedDatabase.exportManifests.length,
    },
    managedRevision: managed.revision,
    redaction: {
      records: "counts-only",
      secrets: "omitted",
    },
  };
}
