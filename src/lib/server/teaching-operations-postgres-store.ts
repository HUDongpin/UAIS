import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { createUaisCoreDatabase, getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import {
  TeachingOperationStoreError,
  normalizeTeachingOperationDatabase,
  type TeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";

const snapshotKey = "default";

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
 * Resolve the managed teaching-operations repository, or `undefined` for the
 * default file backend. Only the Postgres selector is handled here — the
 * store's external append adapters remain a separate concern.
 */
export function createUaisTeachingOperationRepository(input: {
  env: Record<string, string | undefined>;
}): TeachingOperationRepository | undefined {
  if (isUaisTeachingOperationPostgresSelector(input.env.UAIS_TEACHING_OPERATIONS_BACKEND)) {
    return createUaisTeachingOperationPostgresRepository({ env: input.env });
  }
  return undefined;
}

export function createUaisTeachingOperationPostgresRepository(input: {
  env: Record<string, string | undefined>;
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
      const client = createUaisCoreDatabase({ env: input.env, max: 1 });
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
        await client.sql.end({ timeout: 5 });
      }
    },
    write: async ({ database, expectedRevision }) => {
      const normalizedDatabase = normalizeTeachingOperationDatabase(database);
      const revision = createSnapshotRevision(normalizedDatabase);
      const client = createUaisCoreDatabase({ env: input.env, max: 1 });
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
          if (expectedRevision && currentRevision && currentRevision !== expectedRevision) {
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
          await sql`
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
          `;
        });
      } finally {
        await client.sql.end({ timeout: 5 });
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
