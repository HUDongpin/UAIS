import { describe, expect, it } from "vitest";
import { createUaisLearningChatroomTranscriptPostgresRepository } from "@/lib/server/learning-chatroom-transcript-postgres-store";
import { createUaisLearningChatroomSharePostgresRepository } from "@/lib/server/learning-chatroom-share-postgres-store";
import { createEmptyLearningChatroomTranscriptDatabase } from "@/lib/server/learning-chatroom-transcript-store";
import { createEmptyLearningChatroomShareDatabase } from "@/lib/server/learning-chatroom-share-store";

// The Postgres path is what resolves blocker B2, so it cannot be shipped as
// code that merely compiles. These assertions drive the real repositories with
// an injected client that records every statement, which proves the parts a
// type-checker cannot: that the right table is addressed, that the snapshot is
// sent as text and cast server-side, that the revision guard takes FOR UPDATE
// before it decides, and that the connection is closed on every path.
//
// What this does NOT prove is Postgres's own behaviour. That is exercised by
// `npm run db:migrate` at deploy time and by the first real write; the failure
// mode there is a transcript reported "unavailable", never a lost round, since
// the runtime degrades rather than throwing.

const env = { UAIS_CORE_DATABASE_URL: "postgres://user:pass@db.example.com/uais" };

type RecordedQuery = { text: string; values: unknown[] };

function createRecordingClient(options: { rows?: unknown[][] } = {}) {
  const queries: RecordedQuery[] = [];
  const rowQueue = [...(options.rows ?? [])];
  let ended = 0;
  let transactions = 0;

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ text: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return Promise.resolve(rowQueue.shift() ?? []);
  }) as never as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (run: (sql: never) => Promise<void>) => Promise<void>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };

  sql.begin = async (run) => {
    transactions += 1;
    await run(sql as never);
  };
  sql.end = async () => {
    ended += 1;
  };

  return {
    factory: () => ({ sql }),
    queries,
    get ended() {
      return ended;
    },
    get transactions() {
      return transactions;
    },
  };
}

describe("learning chatroom transcript postgres store", () => {
  it("returns an empty database when the snapshot row does not exist yet", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read();

    expect(snapshot.database).toEqual(createEmptyLearningChatroomTranscriptDatabase());
    // No revision on an absent row: the first write must not be told it is
    // replacing something.
    expect(snapshot.revision).toBeUndefined();
    expect(client.queries[0].text).toContain("uais_learning_chatroom_transcript_snapshots");
    expect(client.ended).toBe(1);
  });

  it("normalizes a stored snapshot and carries its revision forward", async () => {
    const stored = {
      ...createEmptyLearningChatroomTranscriptDatabase(),
      updatedAt: "2026-08-09T10:00:00.000Z",
    };
    const client = createRecordingClient({
      rows: [[{ database: stored, revision: "  rev-abc  " }]],
    });
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read();

    expect(snapshot.database.schemaVersion).toBe("uais-learning-chatroom-transcripts-v2");
    expect(snapshot.revision).toBe("rev-abc");
  });

  it("writes the snapshot as text cast to jsonb, inside a transaction", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.write({ database: createEmptyLearningChatroomTranscriptDatabase() });

    expect(client.transactions).toBe(1);
    const select = client.queries[0];
    const insert = client.queries[1];
    // The guard reads FOR UPDATE first so a concurrent writer cannot slip
    // between the check and the replace.
    expect(select.text).toContain("FOR UPDATE");
    expect(insert.text).toContain("INSERT INTO uais_learning_chatroom_transcript_snapshots");
    expect(insert.text).toContain("ON CONFLICT");
    // The cast is the fix for postgres v3.4.9 sending an object parameter
    // unserialized inside a transaction; losing it breaks every write.
    expect(insert.text).toContain("::text::jsonb");
    expect(typeof insert.values[1]).toBe("string");
    expect(client.ended).toBe(1);
  });

  it("refuses to replace a snapshot that moved under it", async () => {
    const client = createRecordingClient({ rows: [[{ revision: "rev-current" }]] });
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({
        database: createEmptyLearningChatroomTranscriptDatabase(),
        expectedRevision: "rev-stale",
      }),
    ).rejects.toThrow(/retry required/);

    // The conflict is detected before any write is issued, and the connection
    // is still closed.
    expect(client.queries.some((query) => query.text.includes("INSERT"))).toBe(false);
    expect(client.ended).toBe(1);
  });

  it("requires a core database url", () => {
    expect(() =>
      createUaisLearningChatroomTranscriptPostgresRepository({ env: {} }),
    ).toThrow(/UAIS_CORE_DATABASE_URL/);
  });
});

describe("learning chatroom share postgres store", () => {
  it("addresses its own table and round-trips an empty snapshot", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisLearningChatroomSharePostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read();
    expect(snapshot.database).toEqual(createEmptyLearningChatroomShareDatabase());
    // Shares and transcripts must never share a row.
    expect(client.queries[0].text).toContain("uais_learning_chatroom_share_snapshots");
    expect(client.queries[0].text).not.toContain("transcript");
  });

  it("writes shares with the same transactional guard", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisLearningChatroomSharePostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.write({ database: createEmptyLearningChatroomShareDatabase() });

    expect(client.transactions).toBe(1);
    expect(client.queries[1].text).toContain(
      "INSERT INTO uais_learning_chatroom_share_snapshots",
    );
    expect(client.queries[1].text).toContain("::text::jsonb");
    expect(client.ended).toBe(1);
  });
});

describe("chatroom snapshot migration", () => {
  it("creates both tables idempotently and is registered to run at deploy", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile("migrations/0003_learning_chatroom.sql", "utf8");
    const runner = await readFile("scripts/apply-core-migrations.mjs", "utf8");

    for (const table of [
      "uais_learning_chatroom_transcript_snapshots",
      "uais_learning_chatroom_share_snapshots",
    ]) {
      // IF NOT EXISTS matters: the runner re-applies on every deploy.
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("snapshot_key text PRIMARY KEY");
    expect(sql).toContain("database jsonb NOT NULL");
    expect(sql).toContain("revision text NOT NULL");
    // A migration that exists but is not registered never runs.
    expect(runner).toContain("0003_learning_chatroom");
  });
});
