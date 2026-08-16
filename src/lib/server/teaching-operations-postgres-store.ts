import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  TeachingOperationStoreError,
  normalizeTeachingOperationDatabase,
  type TeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";

const snapshotKey = "default";

// Test seam, matching teaching-course-management-postgres-store.ts and the two
// chatroom stores. The revision guard below is a statement shape - a FOR UPDATE
// pre-check plus a conditional ON CONFLICT - and neither half is observable
// from a type-checker or from a repository double that never issues SQL.
export type TeachingOperationPostgresClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => {
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (run: (sql: never) => Promise<void>) => Promise<void>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };
};

export type TeachingOperationRepositorySnapshot = {
  database: TeachingOperationDatabase;
  revision?: string;
};

export type TeachingOperationRepository = {
  read: () => Promise<TeachingOperationRepositorySnapshot>;
  write: (input: {
    database: TeachingOperationDatabase;
    expectedRevision?: string;
  }) => Promise<void>;
};

export function isUaisTeachingOperationPostgresSelector(value: string | undefined) {
  const selector = value?.trim().toLowerCase();
  return selector === "postgres" || selector === "managed";
}

/**
 * Resolve the managed teaching-operations snapshot repository, or `undefined`
 * for the default file backend. Keyed on the DEDICATED
 * `UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND` var, NOT the external-append
 * `UAIS_TEACHING_OPERATIONS_BACKEND` (which the external storage-backend contract
 * rejects under `postgres`). This is the resolver the store's backend-aware
 * `loadTeachingOperationDatabase`/`persistTeachingOperationDatabase` helpers use.
 */
export function createUaisTeachingOperationRepository(input: {
  env: Record<string, string | undefined>;
}): TeachingOperationRepository | undefined {
  if (
    isUaisTeachingOperationPostgresSelector(
      input.env.UAIS_TEACHING_OPERATIONS_SNAPSHOT_BACKEND,
    )
  ) {
    return createUaisTeachingOperationPostgresRepository({ env: input.env });
  }
  return undefined;
}

export function createUaisTeachingOperationPostgresRepository(input: {
  env: Record<string, string | undefined>;
  createDatabase?: TeachingOperationPostgresClientFactory;
}): TeachingOperationRepository {
  const readiness = getUaisCoreDatabaseReadiness(input.env);
  if (readiness.status !== "ready") {
    throw new TeachingOperationStoreError(
      503,
      "Postgres teaching operation storage requires UAIS_CORE_DATABASE_URL.",
    );
  }

  return {
    read: async () => {
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env });
      try {
        const rows = await client.sql`
          SELECT database, revision
          FROM uais_teaching_operations_snapshots
          WHERE snapshot_key = ${snapshotKey}
        `;

        if (rows.length === 0) {
          return { database: createEmptyDatabase() };
        }

        const row = rows[0] as { database?: unknown; revision?: unknown };
        const revision = typeof row.revision === "string" ? row.revision.trim() : "";
        return {
          database: normalizeTeachingOperationDatabase(row.database),
          ...(revision ? { revision } : {}),
        };
      } finally {
        // Releases an injected test double or a disposable client exactly as
        // before; a pooled client is kept open for the next request. See
        // closeUaisCoreDatabaseClient for why the distinction is a marker
        // rather than a flag the caller passes.
        await closeUaisCoreDatabaseClient(client);
      }
    },
    write: async ({ database, expectedRevision }) => {
      const normalizedDatabase = normalizeTeachingOperationDatabase(database);
      const revision = createSnapshotRevision(normalizedDatabase);
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env });
      try {
        await client.sql.begin(async (sql: TransactionSql) => {
          const rows = await sql`
            SELECT revision
            FROM uais_teaching_operations_snapshots
            WHERE snapshot_key = ${snapshotKey}
            FOR UPDATE
          `;
          const currentRevision =
            typeof rows[0]?.revision === "string" ? rows[0].revision.trim() : undefined;
          // Strict equality, not "both sides present". The old guard skipped
          // whenever either side was absent, so a writer that read no snapshot
          // and then found one replaced it wholesale - which is exactly what two
          // teachers acting on an empty deployment do, and the first one's
          // action disappeared without an error anywhere. The store's callers
          // already re-read and re-apply on a 409 (see
          // teaching-operations-write-retry.ts), so refusing is the answer that
          // keeps both writes.
          if (rows.length > 0 && currentRevision !== expectedRevision) {
            throw new TeachingOperationStoreError(
              409,
              "Postgres teaching operation snapshot changed; retry required.",
            );
          }

          // Serialize to text and cast text -> jsonb. Do NOT pass the object
          // (sql.json() or directly): in postgres v3.4.9 a jsonb parameter the
          // server describes as type 3802 reaches Bind unserialized inside
          // sql.begin() and throws. Forcing the parameter to text sends the raw
          // JSON string, then ::jsonb parses it server-side.
          //
          // The WHERE on the conflict path closes the window FOR UPDATE cannot:
          // a lock on a row that does not exist yet locks nothing, so two
          // writers arriving at a fresh deployment both see no row and both
          // insert. The second one's DO UPDATE is then skipped, RETURNING is
          // empty, and it retries against the row the first one committed.
          const applied = await sql`
            INSERT INTO uais_teaching_operations_snapshots (
              snapshot_key,
              database,
              revision,
              updated_at
            )
            VALUES (
              ${snapshotKey},
              ${JSON.stringify(normalizedDatabase)}::text::jsonb,
              ${revision},
              now()
            )
            ON CONFLICT (snapshot_key)
            DO UPDATE SET
              database = EXCLUDED.database,
              revision = EXCLUDED.revision,
              updated_at = EXCLUDED.updated_at
            WHERE uais_teaching_operations_snapshots.revision
              IS NOT DISTINCT FROM ${expectedRevision ?? null}::text
            RETURNING snapshot_key
          `;
          if (applied.length === 0) {
            throw new TeachingOperationStoreError(
              409,
              "Postgres teaching operation snapshot changed; retry required.",
            );
          }
        });
      } finally {
        // Releases an injected test double or a disposable client exactly as
        // before; a pooled client is kept open for the next request. See
        // closeUaisCoreDatabaseClient for why the distinction is a marker
        // rather than a flag the caller passes.
        await closeUaisCoreDatabaseClient(client);
      }
    },
  };
}

function createSnapshotRevision(database: TeachingOperationDatabase) {
  return `rev-${createHash("sha256").update(JSON.stringify(database)).digest("hex").slice(0, 24)}`;
}

function createEmptyDatabase(): TeachingOperationDatabase {
  return {
    schemaVersion: "uais-teaching-operations-v1",
    updatedAt: "1970-01-01T00:00:00.000Z",
    records: [],
    auditEvents: [],
    domainProjections: [],
    inviteCodes: [],
    outbox: [],
    exportManifests: [],
  };
}
