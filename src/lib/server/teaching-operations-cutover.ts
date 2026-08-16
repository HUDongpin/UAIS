import {
  normalizeTeachingOperationDatabase,
  readTeachingOperationDatabase,
  type TeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";
import {
  createUaisTeachingOperationPostgresRepository,
  type TeachingOperationPostgresClientFactory,
} from "@/lib/server/teaching-operations-postgres-store";

// Phase 1 durable-data cutover for the teaching-operations entity.
//
// expand -> migrate -> contract:
//  - expand:   the managed Postgres repository (teaching-operations-postgres-store.ts)
//              reads/writes a single jsonb snapshot behind an optimistic-concurrency
//              revision, mirroring the course-management adapter.
//  - migrate:  backfillTeachingOperationsToPostgres() copies the JSON-file snapshot
//              into Postgres and verifies parity; verifyTeachingOperationsParity() is
//              the read-only dual-source gate.
//  - contract: reads/writes switch by setting
//              UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND=postgres — the store's
//              loadTeachingOperationDatabase/persistTeachingOperationDatabase
//              helpers then route through the managed repository. Roll back by
//              unsetting it (the JSON file is never mutated by backfill).
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

type TeachingOperationsCutoverInput = {
  env: Record<string, string | undefined>;
  sourceDataDir?: string;
  // The store's own test seam, passed straight through, so the read-then-write
  // sequence below can be driven without a server.
  createDatabase?: TeachingOperationPostgresClientFactory;
};

/**
 * Backfill: copy the JSON-file snapshot into managed Postgres, then verify parity.
 * The JSON file is the source of truth and is left untouched (rollback stays safe).
 */
export async function backfillTeachingOperationsToPostgres(
  input: TeachingOperationsCutoverInput,
): Promise<TeachingOperationsCutoverParity> {
  const source = normalizeTeachingOperationDatabase(
    await readTeachingOperationDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createRepository(input);
  // Named revision, not an unconditional replace. The backfill is documented as
  // "run it repeatedly until parity holds", so the second run is replacing the
  // row the first one wrote and has to say so - the managed store refuses a
  // write that presents itself as a first writer against an existing row,
  // because that is how one teacher's action used to vanish under another's.
  const managed = await repository.read();
  await repository.write({
    database: source,
    ...(managed.revision ? { expectedRevision: managed.revision } : {}),
  });
  return verifyParityAgainstManaged(source, repository);
}

/**
 * Read-only parity gate between the JSON-file snapshot and managed Postgres.
 * Use before switching reads, and after, to confirm the two sources agree.
 */
export async function verifyTeachingOperationsParity(
  input: TeachingOperationsCutoverInput,
): Promise<TeachingOperationsCutoverParity> {
  const source = normalizeTeachingOperationDatabase(
    await readTeachingOperationDatabase({ dataDir: input.sourceDataDir }),
  );
  const repository = createRepository(input);
  return verifyParityAgainstManaged(source, repository);
}

function createRepository(input: TeachingOperationsCutoverInput) {
  return createUaisTeachingOperationPostgresRepository({
    env: input.env,
    ...(input.createDatabase ? { createDatabase: input.createDatabase } : {}),
  });
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
