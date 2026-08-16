import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import {
  closeUaisCoreDatabaseClient,
  getUaisCoreDatabasePool,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  LearningChatroomTranscriptStoreError,
  createEmptyLearningChatroomTranscriptDatabase,
  normalizeLearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptRepository,
  type LearningChatroomTranscriptStorageDescriptor,
} from "@/lib/server/learning-chatroom-transcript-store";

// Chatroom transcripts on the core database.
//
// Production refuses local JSON, which used to leave one durable option: a
// separately operated external-storage service that an operator had to point at
// and hold a token for, and that had to be kept in schema step with this app.
// The managed Postgres is already required in production, so this gives the
// resource a durable home that needs no additional configuration and no second
// deployment to version-match.
//
// ONE ROW PER ROOM, keyed by the transcript id the store already derives. It
// used to mirror the teaching-course-management store exactly - a single
// 'default' row holding every transcript in the deployment - and that is the
// wrong shape for this resource: every append took FOR UPDATE on the one row and
// rewrote the whole corpus, so a group room's members lost appends to conflicts
// raised by students in other courses, and the sha256 revision moved whenever
// anyone anywhere spoke. Course management gets away with it because it has a
// handful of writers; a chatroom has one per member of every live room. Row per
// room means a row is contended only by the people actually in it. See
// migrations/0006_learning_chatroom_per_room.sql, which retires the old row.

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

const postgresLearningChatroomTranscriptStorage: LearningChatroomTranscriptStorageDescriptor =
  {
    transcriptStoragePolicy: "postgres-learning-chatroom-transcripts",
    storageWritePolicy: "postgres-transactional-snapshot-replace",
  };

export function createUaisLearningChatroomTranscriptPostgresRepository(input: {
  env: Record<string, string | undefined>;
  createDatabase?: LearningChatroomPostgresClientFactory;
}): LearningChatroomTranscriptRepository {
  const readiness = getUaisCoreDatabaseReadiness(input.env);
  if (readiness.status !== "ready") {
    throw new LearningChatroomTranscriptStoreError(
      503,
      "Postgres learning chatroom transcript storage requires UAIS_CORE_DATABASE_URL.",
    );
  }

  return {
    storage: postgresLearningChatroomTranscriptStorage,
    read: async (scope) => {
      const roomKey = readRoomKey(scope?.transcriptId);
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env, max: 1 });
      try {
        // An unnamed room means "every room", which is how a corpus-wide reader
        // still works after the re-key. It carries no revision: there is no
        // single row for an optimistic guard to be about, and inventing one
        // would let a corpus-wide writer believe it had a lock it never took.
        if (!roomKey) {
          const rows = await client.sql`
            SELECT database
            FROM uais_learning_chatroom_transcript_snapshots
            ORDER BY snapshot_key
          `;
          return { database: mergeRoomDatabases(rows) };
        }

        const rows = await client.sql`
          SELECT database, revision
          FROM uais_learning_chatroom_transcript_snapshots
          WHERE snapshot_key = ${roomKey}
        `;
        if (rows.length === 0) {
          return { database: createEmptyLearningChatroomTranscriptDatabase() };
        }
        const row = rows[0] as { database?: unknown; revision?: unknown };
        const revision = typeof row.revision === "string" ? row.revision.trim() : "";
        return {
          database: normalizeLearningChatroomTranscriptDatabase(row.database),
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
    write: async ({ database, expectedRevision, transcriptId }) => {
      const roomKey = readRoomKey(transcriptId);
      if (!roomKey) {
        // A corpus-wide replace is no longer expressible: it would have to take
        // every room's lock at once, and its expectedRevision would be about a
        // row that no longer exists. Refusing loudly beats writing the whole
        // deployment's transcripts into one room's row.
        throw new LearningChatroomTranscriptStoreError(
          500,
          "Postgres learning chatroom transcript writes are per room and require a transcript id.",
        );
      }
      const roomDatabase = selectRoomDatabase(database, roomKey);
      const revision = createSnapshotRevision(roomDatabase);
      const client = (input.createDatabase ?? getUaisCoreDatabasePool)({ env: input.env, max: 1 });
      try {
        await client.sql.begin(async (sql: TransactionSql) => {
          const rows = await sql`
            SELECT revision
            FROM uais_learning_chatroom_transcript_snapshots
            WHERE snapshot_key = ${roomKey}
            FOR UPDATE
          `;
          const currentRevision =
            typeof rows[0]?.revision === "string" ? rows[0].revision.trim() : undefined;
          // Strict equality, not "both sides present": a writer that read no row
          // and then finds one has been overtaken by whoever created the room,
          // and overwriting it would silently drop that member's first message.
          if (rows.length > 0 && currentRevision !== expectedRevision) {
            throw new LearningChatroomTranscriptStoreError(
              409,
              "Postgres learning chatroom transcript snapshot changed; retry required.",
            );
          }

          // text -> jsonb rather than a jsonb parameter: postgres v3.4.9 sends an
          // object parameter unserialized inside sql.begin(). Same reason and
          // same fix as the course-management store.
          //
          // The WHERE on the conflict path closes the window FOR UPDATE cannot:
          // a lock on a row that does not exist yet locks nothing, so two members
          // opening the same room at the same instant both see no row and both
          // insert. The second one's DO UPDATE is then skipped, RETURNING is
          // empty, and it retries against the row the first one committed.
          const applied = await sql`
            INSERT INTO uais_learning_chatroom_transcript_snapshots (
              snapshot_key, database, revision, updated_at
            )
            VALUES (
              ${roomKey},
              ${JSON.stringify(roomDatabase)}::text::jsonb,
              ${revision},
              now()
            )
            ON CONFLICT (snapshot_key)
            DO UPDATE SET
              database = EXCLUDED.database,
              revision = EXCLUDED.revision,
              updated_at = EXCLUDED.updated_at
            WHERE uais_learning_chatroom_transcript_snapshots.revision
              IS NOT DISTINCT FROM ${expectedRevision ?? null}::text
            RETURNING snapshot_key
          `;
          if (applied.length === 0) {
            throw new LearningChatroomTranscriptStoreError(
              409,
              "Postgres learning chatroom transcript snapshot changed; retry required.",
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

// A room's row holds the same database envelope the rest of the store speaks,
// with a single-element `transcripts` array. Keeping the envelope means the
// normalizer, the schema-version upgrade and the external-storage serializer all
// keep working unchanged; only the number of transcripts per row moved.
function selectRoomDatabase(
  database: LearningChatroomTranscriptDatabase,
  roomKey: string,
): LearningChatroomTranscriptDatabase {
  const normalized = normalizeLearningChatroomTranscriptDatabase(database);
  return {
    ...normalized,
    transcripts: normalized.transcripts.filter(
      (transcript) => transcript.transcriptId === roomKey,
    ),
  };
}

function mergeRoomDatabases(rows: unknown[]): LearningChatroomTranscriptDatabase {
  const merged = createEmptyLearningChatroomTranscriptDatabase();
  for (const row of rows) {
    const database = normalizeLearningChatroomTranscriptDatabase(
      (row as { database?: unknown }).database,
    );
    merged.transcripts.push(...database.transcripts);
    // Every writer stamps the same ISO format, so the newest room write is the
    // corpus timestamp.
    if (database.updatedAt > merged.updatedAt) {
      merged.updatedAt = database.updatedAt;
    }
  }
  return merged;
}

function readRoomKey(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function createSnapshotRevision(database: LearningChatroomTranscriptDatabase) {
  return `rev-${createHash("sha256").update(JSON.stringify(database)).digest("hex").slice(0, 24)}`;
}
