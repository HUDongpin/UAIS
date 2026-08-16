import { describe, expect, it } from "vitest";
import { UAIS_CORE_DATABASE_MIGRATION_VERSIONS } from "@/lib/db/migrations";
import { createUaisLearningChatroomTranscriptPostgresRepository } from "@/lib/server/learning-chatroom-transcript-postgres-store";
import { createUaisLearningChatroomSharePostgresRepository } from "@/lib/server/learning-chatroom-share-postgres-store";
import {
  appendLearningChatroomTranscriptMessages,
  createEmptyLearningChatroomTranscriptDatabase,
  createLearningChatroomTranscriptId,
  nextLearningChatroomTranscriptRetryDelayMs,
  type LearningChatroomTranscriptDatabase,
} from "@/lib/server/learning-chatroom-transcript-store";
import { createEmptyLearningChatroomShareDatabase } from "@/lib/server/learning-chatroom-share-store";

// The Postgres path is what resolves blocker B2, so it cannot be shipped as
// code that merely compiles. These assertions drive the real repositories with
// an injected client that records every statement, which proves the parts a
// type-checker cannot: that the right table is addressed, that the snapshot is
// sent as text and cast server-side, that the revision guard takes FOR UPDATE
// before it decides, and that the connection is closed on every path.
//
// Since the transcript re-key they also prove the property the single 'default'
// row could not have: two rooms appending at the same moment neither lock nor
// conflict with each other, and the retired key is never named again.
//
// What this does NOT prove is Postgres's own behaviour. That is exercised by
// `npm run db:migrate` at deploy time and by the first real write; the failure
// mode there is a transcript reported "unavailable", never a lost round, since
// the runtime degrades rather than throwing.

const env = { UAIS_CORE_DATABASE_URL: "postgres://user:pass@db.example.com/uais" };

const groupOne = {
  courseId: "elementary-math-research",
  classId: "elementary-math-research-class-1",
  groupId: "group-one",
  studentId: "Alice",
};
const groupTwo = {
  courseId: "elementary-math-research",
  classId: "elementary-math-research-class-1",
  groupId: "group-two",
  studentId: "Bob",
};
const groupOneKey = createLearningChatroomTranscriptId(groupOne);
const groupTwoKey = createLearningChatroomTranscriptId(groupTwo);

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

// A keyed double that answers the four statements the store issues against a
// real table of rows, including the ON CONFLICT ... WHERE guard. A canned queue
// cannot express the thing under test here - that one room's row is untouched by
// another room's append - because that is a property of the KEY, not of the
// order the statements arrive in.
function createRoomAwareClient() {
  const rows = new Map<string, { database: unknown; revision: string }>();
  const queries: RecordedQuery[] = [];

  const execute = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });

    if (text.startsWith("SELECT database, revision")) {
      const row = rows.get(String(values[0]));
      return row ? [{ database: row.database, revision: row.revision }] : [];
    }
    if (text.startsWith("SELECT database FROM")) {
      return [...rows.keys()].sort().map((key) => ({ database: rows.get(key)?.database }));
    }
    if (text.startsWith("SELECT revision")) {
      const row = rows.get(String(values[0]));
      return row ? [{ revision: row.revision }] : [];
    }
    if (text.startsWith("INSERT INTO")) {
      const [key, database, revision, expectedRevision] = values;
      const existing = rows.get(String(key));
      // `DO UPDATE ... WHERE revision IS NOT DISTINCT FROM $4`: an existing row
      // is replaced only when its revision is the one the writer read, and a
      // writer that read nothing expects null.
      if (existing && existing.revision !== (expectedRevision ?? null)) {
        return [];
      }
      rows.set(String(key), {
        database: JSON.parse(String(database)),
        revision: String(revision),
      });
      return [{ snapshot_key: key }];
    }
    return [];
  };

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(execute(strings, values))) as never as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (run: (sql: never) => Promise<void>) => Promise<void>;
    end: (options?: { timeout?: number }) => Promise<void>;
  };

  sql.begin = async (run) => {
    await run(sql as never);
  };
  sql.end = async () => {};

  return {
    factory: () => ({ sql }),
    queries,
    rowKeys: () => [...rows.keys()].sort(),
    databaseFor: (key: string) =>
      rows.get(key)?.database as LearningChatroomTranscriptDatabase | undefined,
    statements: (prefix: string) =>
      queries.filter((query) => query.text.startsWith(prefix)),
  };
}

describe("learning chatroom transcript postgres store", () => {
  it("returns an empty database when the room's row does not exist yet", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read({ transcriptId: groupOneKey });

    expect(snapshot.database).toEqual(createEmptyLearningChatroomTranscriptDatabase());
    // No revision on an absent row: the first write must not be told it is
    // replacing something.
    expect(snapshot.revision).toBeUndefined();
    expect(client.queries[0].text).toContain("uais_learning_chatroom_transcript_snapshots");
    // The read fetches ONE room, by its own key.
    expect(client.queries[0].text).toContain("WHERE snapshot_key = ?");
    expect(client.queries[0].values).toEqual([groupOneKey]);
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

    const snapshot = await repository.read({ transcriptId: groupOneKey });

    expect(snapshot.database.schemaVersion).toBe("uais-learning-chatroom-transcripts-v2");
    expect(snapshot.revision).toBe("rev-abc");
  });

  it("writes the snapshot as text cast to jsonb, inside a transaction", async () => {
    const client = createRecordingClient({ rows: [[], [{ snapshot_key: groupOneKey }]] });
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.write({
      database: createEmptyLearningChatroomTranscriptDatabase(),
      transcriptId: groupOneKey,
    });

    expect(client.transactions).toBe(1);
    const select = client.queries[0];
    const insert = client.queries[1];
    // The guard reads FOR UPDATE first so a concurrent writer cannot slip
    // between the check and the replace - and it locks this room's row only.
    expect(select.text).toContain("FOR UPDATE");
    expect(select.values).toEqual([groupOneKey]);
    expect(insert.text).toContain("INSERT INTO uais_learning_chatroom_transcript_snapshots");
    expect(insert.text).toContain("ON CONFLICT");
    // The cast is the fix for postgres v3.4.9 sending an object parameter
    // unserialized inside a transaction; losing it breaks every write.
    expect(insert.text).toContain("::text::jsonb");
    expect(insert.values[0]).toBe(groupOneKey);
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
        transcriptId: groupOneKey,
        expectedRevision: "rev-stale",
      }),
    ).rejects.toThrow(/retry required/);

    // The conflict is detected before any write is issued, and the connection
    // is still closed.
    expect(client.queries.some((query) => query.text.includes("INSERT"))).toBe(false);
    expect(client.ended).toBe(1);
  });

  it("refuses to replace a room that appeared while it was reading", async () => {
    // The window FOR UPDATE cannot close: a lock on a row that does not exist
    // locks nothing, so two members opening the same room both see nothing. The
    // conflict guard on the INSERT path is what makes the loser retry instead of
    // overwriting the winner's first message.
    const client = createRecordingClient({ rows: [[], []] });
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({
        database: createEmptyLearningChatroomTranscriptDatabase(),
        transcriptId: groupOneKey,
      }),
    ).rejects.toThrow(/retry required/);
    expect(client.ended).toBe(1);
  });

  it("never names the retired 'default' row", async () => {
    const client = createRoomAwareClient();
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.read({ transcriptId: groupOneKey });
    await repository.write({
      database: createEmptyLearningChatroomTranscriptDatabase(),
      transcriptId: groupOneKey,
    });

    expect(client.queries.length).toBeGreaterThan(0);
    for (const query of client.queries) {
      expect(query.values).not.toContain("default");
      expect(query.text).not.toContain("'default'");
    }
  });

  it("keeps two rooms appending at the same time out of each other's way", async () => {
    const client = createRoomAwareClient();
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const [first, second] = await Promise.all([
      appendLearningChatroomTranscriptMessages({
        repository,
        ...groupOne,
        messages: [{ messageId: "a-1", role: "student" as const, content: "第一组的问题" }],
        now: "2026-08-16T09:00:00.000Z",
      }),
      appendLearningChatroomTranscriptMessages({
        repository,
        ...groupTwo,
        messages: [{ messageId: "b-1", role: "student" as const, content: "第二组的问题" }],
        now: "2026-08-16T09:00:00.000Z",
      }),
    ]);

    expect(first.status).toBe("persisted");
    expect(second.status).toBe("persisted");
    // One row each, and exactly one INSERT each: neither append was made to
    // retry, which is the whole point of the re-key. Under the single 'default'
    // row these two writers shared a lock and a revision.
    expect(client.rowKeys()).toEqual([groupOneKey, groupTwoKey].sort());
    expect(client.statements("INSERT INTO")).toHaveLength(2);
    // A room's row carries that room only.
    expect(
      client.databaseFor(groupOneKey)?.transcripts.map((item) => item.transcriptId),
    ).toEqual([groupOneKey]);
    expect(
      client.databaseFor(groupTwoKey)?.transcripts.map((item) => item.transcriptId),
    ).toEqual([groupTwoKey]);
  });

  it("loses no append when two members write the same room at once", async () => {
    const client = createRoomAwareClient();
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const [first, second] = await Promise.all([
      appendLearningChatroomTranscriptMessages({
        repository,
        ...groupOne,
        messages: [{ messageId: "a-1", role: "student" as const, content: "第一位同学" }],
        now: "2026-08-16T09:00:00.000Z",
      }),
      appendLearningChatroomTranscriptMessages({
        repository,
        ...groupOne,
        studentId: "Bob",
        messages: [{ messageId: "b-1", role: "student" as const, content: "第二位同学" }],
        now: "2026-08-16T09:00:01.000Z",
      }),
    ]);

    expect(first.status).toBe("persisted");
    expect(second.status).toBe("persisted");
    expect(client.rowKeys()).toEqual([groupOneKey]);
    // The loser of the race retried against the winner's row instead of
    // overwriting it, so both turns survive.
    expect(
      client.databaseFor(groupOneKey)?.transcripts[0].messages.map(
        (message) => message.messageId,
      ),
    ).toEqual(expect.arrayContaining(["a-1", "b-1"]));
  });

  it("still answers a corpus-wide read by enumerating the rooms", async () => {
    const client = createRoomAwareClient();
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });
    await appendLearningChatroomTranscriptMessages({
      repository,
      ...groupOne,
      messages: [{ messageId: "a-1", role: "student" as const, content: "第一组的问题" }],
      now: "2026-08-16T09:00:00.000Z",
    });
    await appendLearningChatroomTranscriptMessages({
      repository,
      ...groupTwo,
      messages: [{ messageId: "b-1", role: "student" as const, content: "第二组的问题" }],
      now: "2026-08-16T09:00:02.000Z",
    });

    const snapshot = await repository.read();

    expect(snapshot.database.transcripts.map((item) => item.transcriptId).sort()).toEqual(
      [groupOneKey, groupTwoKey].sort(),
    );
    // No single row backs a corpus read, so it carries no revision for an
    // optimistic guard to be about.
    expect(snapshot.revision).toBeUndefined();
    expect(snapshot.database.updatedAt).toBe("2026-08-16T09:00:02.000Z");
  });

  it("refuses a corpus-wide write", async () => {
    const client = createRoomAwareClient();
    const repository = createUaisLearningChatroomTranscriptPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({ database: createEmptyLearningChatroomTranscriptDatabase() }),
    ).rejects.toThrow(/require a transcript id/);
    expect(client.statements("INSERT INTO")).toHaveLength(0);
  });

  it("requires a core database url", () => {
    expect(() =>
      createUaisLearningChatroomTranscriptPostgresRepository({ env: {} }),
    ).toThrow(/UAIS_CORE_DATABASE_URL/);
  });
});

describe("learning chatroom transcript append backoff", () => {
  it("draws a decorrelated-jitter wait that grows and is capped", () => {
    // First retry: drawn from [base, base * 3].
    expect(
      nextLearningChatroomTranscriptRetryDelayMs({ previousDelayMs: 0, random: 0 }),
    ).toBe(25);
    expect(
      nextLearningChatroomTranscriptRetryDelayMs({ previousDelayMs: 0, random: 1 }),
    ).toBe(75);
    // Later retries widen from the previous draw...
    expect(
      nextLearningChatroomTranscriptRetryDelayMs({ previousDelayMs: 75, random: 1 }),
    ).toBe(225);
    // ...but never past the cap, so a learner is never left waiting on backoff.
    expect(
      nextLearningChatroomTranscriptRetryDelayMs({ previousDelayMs: 500, random: 1 }),
    ).toBe(250);
  });

  it("spreads the losers of a race rather than re-colliding them", () => {
    const draws = new Set(
      Array.from({ length: 64 }, () =>
        nextLearningChatroomTranscriptRetryDelayMs({ previousDelayMs: 75 }),
      ),
    );

    // The point of jitter: identical writers must not wake up together.
    expect(draws.size).toBeGreaterThan(1);
    for (const draw of draws) {
      expect(draw).toBeGreaterThanOrEqual(25);
      expect(draw).toBeLessThanOrEqual(225);
    }
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

  // Shares stay global by decision: one small, rarely written capability list
  // with no per-room contention. The transcript re-key must not have dragged it
  // along.
  it("keeps its single 'default' row", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisLearningChatroomSharePostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.read();

    expect(client.queries[0].values).toEqual(["default"]);
  });
});

describe("chatroom snapshot migration", () => {
  it("creates both tables idempotently and is registered to run at deploy", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile("migrations/0003_learning_chatroom.sql", "utf8");

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
    // A migration that exists but is not registered never runs. The runner
    // derives its work list from migrations/*.sql and this inventory is pinned
    // to that same directory (tests/core-database-foundation.test.ts), so a
    // version named here is a version the deploy applies.
    expect(UAIS_CORE_DATABASE_MIGRATION_VERSIONS).toContain("0003_learning_chatroom");
  });

  it("splits the single transcript row per room and retires it", async () => {
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile("migrations/0006_learning_chatroom_per_room.sql", "utf8");

    // One row per transcript the old row carried...
    expect(sql).toContain("jsonb_array_elements(legacy.database->'transcripts')");
    expect(sql).toContain("room.transcript->>'transcriptId'");
    // ...without ever rolling back a room the application has since written.
    expect(sql).toContain("ON CONFLICT (snapshot_key) DO NOTHING");
    // ...and the old row is archived and then removed, so it cannot be read.
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS uais_learning_chatroom_transcript_snapshots_retired",
    );
    expect(sql).toContain("DELETE FROM uais_learning_chatroom_transcript_snapshots");
    expect(sql).toContain("WHERE snapshot_key = 'default'");
    // Shares keep their global row; the split may name that table in its
    // commentary but must not issue a statement against it.
    expect(sql).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+uais_learning_chatroom_share_snapshots/,
    );
    // A migration that exists but is not registered never runs. The runner
    // derives its work list from migrations/*.sql and this inventory is pinned
    // to that same directory (tests/core-database-foundation.test.ts), so a
    // version named here is a version the deploy applies.
    expect(UAIS_CORE_DATABASE_MIGRATION_VERSIONS).toContain("0006_learning_chatroom_per_room");
  });
});
