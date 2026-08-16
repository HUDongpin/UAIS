import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  LearningChatroomShareStoreError,
  createEmptyLearningChatroomShareDatabase,
  normalizeLearningChatroomShareDatabase,
  type LearningChatroomShareDatabase,
  type LearningChatroomShareRepository,
  type LearningChatroomShareStorageDescriptor,
} from "@/lib/server/learning-chatroom-share-store";

// Chatroom shares on the core database.
//
// Production refuses local JSON, which used to leave one durable option: a
// separately operated external-storage service that an operator had to point at
// and hold a token for, and that had to be kept in schema step with this app.
// The managed Postgres is already required in production, so this gives the
// resource a durable home that needs no additional configuration and no second
// deployment to version-match.
//
// Mirrors the teaching-course-management postgres store exactly: one jsonb
// snapshot row guarded by an optimistic revision, replaced inside a transaction
// that takes FOR UPDATE first.

// Test seam. The store reaches a real Postgres through `createUaisCoreDatabase`;
// injecting that factory lets a suite drive the SQL shape, the revision guard
// and the connection cleanup without a server, which is the difference between
// "this compiles" and "this issues the statements it claims to".
export type LearningChatroomPostgresClientFactory = (input: {
  env: Record<string, string | undefined>;
  max?: number;
}) => {
  sql: {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (run: (sql: never) => Promise<void>) => Promise<void>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };
};

const snapshotKey = "default";

const postgresLearningChatroomShareStorage: LearningChatroomShareStorageDescriptor =
  {
    shareStoragePolicy: "postgres-learning-chatroom-shares",
    storageWritePolicy: "postgres-transactional-snapshot-replace",
  };

export function createUaisLearningChatroomSharePostgresRepository(input: {
  env: Record<string, string | undefined>;
  createDatabase?: LearningChatroomPostgresClientFactory;
}): LearningChatroomShareRepository {
  const readiness = getUaisCoreDatabaseReadiness(input.env);
  if (readiness.status !== "ready") {
    throw new LearningChatroomShareStoreError(
      503,
      "Postgres learning chatroom share storage requires UAIS_CORE_DATABASE_URL.",
    );
  }

  return {
    storage: postgresLearningChatroomShareStorage,
    read: async () => {
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env, max: 1 });
      try {
        const rows = await client.sql`
          SELECT database, revision
          FROM uais_learning_chatroom_share_snapshots
          WHERE snapshot_key = ${snapshotKey}
        `;
        if (rows.length === 0) {
          return { database: createEmptyLearningChatroomShareDatabase() };
        }
        const row = rows[0] as { database?: unknown; revision?: unknown };
        const revision = typeof row.revision === "string" ? row.revision.trim() : "";
        return {
          database: normalizeLearningChatroomShareDatabase(row.database),
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
      const normalizedDatabase = normalizeLearningChatroomShareDatabase(database);
      const revision = createSnapshotRevision(normalizedDatabase);
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env, max: 1 });
      try {
        await client.sql.begin(async (sql: TransactionSql) => {
          const rows = await sql`
            SELECT revision
            FROM uais_learning_chatroom_share_snapshots
            WHERE snapshot_key = ${snapshotKey}
            FOR UPDATE
          `;
          const currentRevision =
            typeof rows[0]?.revision === "string" ? rows[0].revision.trim() : undefined;
          if (expectedRevision && currentRevision && currentRevision !== expectedRevision) {
            throw new LearningChatroomShareStoreError(
              409,
              "Postgres learning chatroom share snapshot changed; retry required.",
            );
          }

          // text -> jsonb rather than a jsonb parameter: postgres v3.4.9 sends an
          // object parameter unserialized inside sql.begin(). Same reason and
          // same fix as the course-management store.
          await sql`
            INSERT INTO uais_learning_chatroom_share_snapshots (
              snapshot_key, database, revision, updated_at
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
        // Releases an injected test double or a disposable client exactly as
        // before; a pooled client is kept open for the next request. See
        // closeUaisCoreDatabaseClient for why the distinction is a marker
        // rather than a flag the caller passes.
        await closeUaisCoreDatabaseClient(client);
      }
    },
  };
}

function createSnapshotRevision(database: LearningChatroomShareDatabase) {
  return `rev-${createHash("sha256").update(JSON.stringify(database)).digest("hex").slice(0, 24)}`;
}
