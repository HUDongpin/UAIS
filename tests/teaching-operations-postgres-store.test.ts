import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  backfillTeachingOperationsToPostgres,
  verifyTeachingOperationsParity,
} from "@/lib/server/teaching-operations-cutover";
import { createUaisTeachingOperationPostgresRepository } from "@/lib/server/teaching-operations-postgres-store";
import {
  normalizeTeachingOperationDatabase,
  type TeachingOperationDatabase,
} from "@/lib/server/teaching-operations-store";

// The teaching-operations snapshot is still ONE row, so its optimistic guard is
// the only thing standing between two teachers acting at the same moment and one
// of the two actions disappearing. That guard used to be
// `expectedRevision && currentRevision && !==`, which skipped whenever either
// side was absent, over an upsert with no conditional WHERE - so the writer that
// read nothing replaced whatever it found, and the retry ladder in
// teaching-operations-write-retry.ts never fired because nothing ever raised.
//
// These assertions drive the real repository with an injected client that
// records every statement, which is the only way to see the parts a type-checker
// and a repository double cannot: that the pre-check takes FOR UPDATE, that the
// INSERT carries the conditional ON CONFLICT with RETURNING, that the snapshot
// is sent as text and cast server-side, and that an empty RETURNING becomes a
// 409 rather than a silent success.
//
// What this does NOT prove is Postgres's own behaviour. That is exercised by
// tests/teaching-operations-cutover-integration.test.ts when a database url is
// present (npm run test:db).

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

// A keyed double that answers the statements against a real row, including the
// `ON CONFLICT ... WHERE revision IS NOT DISTINCT FROM` guard. A canned queue
// cannot express the property under test - that the SECOND writer to reach a
// fresh row is refused - because that is a property of the row's state, not of
// the order the statements arrive in.
function createRowAwareClient() {
  let row: { database: unknown; revision: string } | undefined;
  const queries: RecordedQuery[] = [];

  const execute = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });

    if (text.startsWith("SELECT database, revision")) {
      return row ? [{ database: row.database, revision: row.revision }] : [];
    }
    if (text.startsWith("SELECT revision")) {
      return row ? [{ revision: row.revision }] : [];
    }
    if (text.startsWith("INSERT INTO uais_teaching_operations_snapshots")) {
      const [, database, revision, expectedRevision] = values;
      if (row && row.revision !== (expectedRevision ?? null)) {
        return [];
      }
      row = { database: JSON.parse(String(database)), revision: String(revision) };
      return [{ snapshot_key: "default" }];
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
    storedDatabase: () => row?.database as TeachingOperationDatabase | undefined,
    statements: (prefix: string) => queries.filter((query) => query.text.startsWith(prefix)),
  };
}

function buildInviteCode(inviteId: string) {
  return {
    inviteId,
    operationId: "invite-code" as const,
    code: "55395057",
    status: "generated" as const,
    actorId: "teacher-kang",
    createdAt: "2026-08-16T09:00:00.000Z",
  };
}

function buildDatabase(inviteIds: string[]): TeachingOperationDatabase {
  return normalizeTeachingOperationDatabase({
    schemaVersion: "uais-teaching-operations-v1",
    updatedAt: "2026-08-16T09:00:00.000Z",
    records: [],
    auditEvents: [],
    domainProjections: [],
    inviteCodes: inviteIds.map(buildInviteCode),
    outbox: [],
    exportManifests: [],
  });
}

describe("teaching operations postgres store", () => {
  it("returns an empty database when the snapshot row does not exist yet", async () => {
    const client = createRecordingClient({ rows: [[]] });
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read();

    expect(snapshot.database.inviteCodes).toEqual([]);
    // No revision on an absent row: the first write must not be told it is
    // replacing something.
    expect(snapshot.revision).toBeUndefined();
    expect(client.queries[0].text).toContain("uais_teaching_operations_snapshots");
    expect(client.ended).toBe(1);
  });

  it("normalizes a stored snapshot and carries its trimmed revision forward", async () => {
    const client = createRecordingClient({
      rows: [[{ database: buildDatabase(["invite-a"]), revision: "  rev-abc  " }]],
    });
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    const snapshot = await repository.read();

    expect(snapshot.database.inviteCodes.map((code) => code.inviteId)).toEqual([
      "invite-a",
    ]);
    expect(snapshot.revision).toBe("rev-abc");
  });

  it("writes the snapshot as text cast to jsonb under a conditional upsert", async () => {
    const client = createRecordingClient({ rows: [[], [{ snapshot_key: "default" }]] });
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.write({ database: buildDatabase(["invite-a"]) });

    expect(client.transactions).toBe(1);
    const select = client.queries[0];
    const insert = client.queries[1];
    // The guard reads FOR UPDATE first so a concurrent writer cannot slip
    // between the check and the replace.
    expect(select.text).toContain("FOR UPDATE");
    expect(insert.text).toContain("INSERT INTO uais_teaching_operations_snapshots");
    // The conditional conflict path is the half FOR UPDATE cannot provide, and
    // RETURNING is how the store learns the update was skipped.
    expect(insert.text).toContain("IS NOT DISTINCT FROM");
    expect(insert.text).toContain("RETURNING snapshot_key");
    // The cast is the fix for postgres v3.4.9 sending an object parameter
    // unserialized inside a transaction; losing it breaks every write.
    expect(insert.text).toContain("::text::jsonb");
    expect(typeof insert.values[1]).toBe("string");
    // A writer that read no revision expects null, not "any".
    expect(insert.values[3]).toBeNull();
    expect(client.ended).toBe(1);
  });

  it("refuses to replace a snapshot that moved under it", async () => {
    const client = createRecordingClient({ rows: [[{ revision: "rev-current" }]] });
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({
        database: buildDatabase(["invite-a"]),
        expectedRevision: "rev-stale",
      }),
    ).rejects.toThrow(/retry required/);

    // The conflict is detected before any write is issued, and the connection is
    // still closed.
    expect(client.queries.some((query) => query.text.includes("INSERT"))).toBe(false);
    expect(client.ended).toBe(1);
  });

  it("refuses an unguarded replace of a snapshot that already exists", async () => {
    // The old guard skipped this case entirely: no expectedRevision meant no
    // check and no conditional WHERE, so a caller that had read nothing
    // overwrote a snapshot it never saw and the loser's action was gone with no
    // error anywhere.
    const client = createRecordingClient({ rows: [[{ revision: "rev-current" }]] });
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({ database: buildDatabase(["invite-a"]) }),
    ).rejects.toThrow(/retry required/);
    expect(client.queries.some((query) => query.text.includes("INSERT"))).toBe(false);
    expect(client.ended).toBe(1);
  });

  it("refuses a first write that another writer committed first", async () => {
    // The window FOR UPDATE cannot close: a lock on a row that does not exist
    // locks nothing, so two writers arriving at a fresh deployment both see
    // nothing. The conditional conflict path is what makes the loser retry
    // instead of overwriting the winner.
    const client = createRecordingClient({ rows: [[], []] });
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await expect(
      repository.write({ database: buildDatabase(["invite-a"]) }),
    ).rejects.toThrow(/retry required/);
    expect(client.ended).toBe(1);
  });

  it("keeps the loser of a first-write race out of the row", async () => {
    const client = createRowAwareClient();
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    // Both writers read the empty snapshot before either committed.
    const first = await repository.read();
    const second = await repository.read();
    expect(first.revision).toBeUndefined();
    expect(second.revision).toBeUndefined();

    await repository.write({ database: buildDatabase(["invite-first"]) });
    await expect(
      repository.write({ database: buildDatabase(["invite-second"]) }),
    ).rejects.toThrow(/retry required/);

    // The winner's action survived. Before the guard closed, the row held
    // "invite-second" and nothing recorded that "invite-first" had ever been
    // written.
    expect(
      client.storedDatabase()?.inviteCodes.map((code) => code.inviteId),
    ).toEqual(["invite-first"]);
  });

  it("replaces the row when the writer names the revision it read", async () => {
    const client = createRowAwareClient();
    const repository = createUaisTeachingOperationPostgresRepository({
      env,
      createDatabase: client.factory,
    });

    await repository.write({ database: buildDatabase(["invite-first"]) });
    const snapshot = await repository.read();
    expect(snapshot.revision).toBeTruthy();

    await repository.write({
      database: buildDatabase(["invite-first", "invite-second"]),
      expectedRevision: snapshot.revision,
    });

    expect(
      client.storedDatabase()?.inviteCodes.map((code) => code.inviteId),
    ).toEqual(["invite-first", "invite-second"]);
    expect(
      client.statements("INSERT INTO uais_teaching_operations_snapshots"),
    ).toHaveLength(2);
  });

  it("requires a core database url", () => {
    expect(() => createUaisTeachingOperationPostgresRepository({ env: {} })).toThrow(
      /UAIS_CORE_DATABASE_URL/,
    );
  });
});

// The cutover tooling is the caller most exposed to the tightened guard: it is
// documented as "run it repeatedly until parity holds", so its second run is a
// replace of the row its first run wrote.
describe("teaching operations durable cutover", () => {
  async function seedJsonFile(dataDir: string, database: TeachingOperationDatabase) {
    await writeFile(
      join(dataDir, "teaching-operations.json"),
      JSON.stringify(database),
      "utf8",
    );
  }

  it("backfills the file snapshot, and stays parity when run again", async () => {
    const client = createRowAwareClient();
    const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-cutover-unit-"));
    try {
      await seedJsonFile(dataDir, buildDatabase(["invite-a"]));

      const first = await backfillTeachingOperationsToPostgres({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });
      expect(first.status).toBe("parity");
      expect(first.entityCounts.inviteCodes).toBe(1);
      expect(first.managedRevision).toBeTruthy();

      // The re-run names the revision it read. An unguarded second write would
      // now be refused, which is how a tightened store breaks its own migration
      // tooling silently.
      const second = await backfillTeachingOperationsToPostgres({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });
      expect(second.status).toBe("parity");
      // Redaction: the parity result carries counts, never record contents.
      expect(JSON.stringify(second)).not.toContain("invite-a");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reports mismatch when the file snapshot moves after the backfill", async () => {
    const client = createRowAwareClient();
    const dataDir = await mkdtemp(join(tmpdir(), "uais-ops-cutover-drift-"));
    try {
      await seedJsonFile(dataDir, buildDatabase(["invite-a"]));
      await backfillTeachingOperationsToPostgres({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });

      await seedJsonFile(dataDir, buildDatabase(["invite-a", "invite-b"]));
      const drift = await verifyTeachingOperationsParity({
        env,
        sourceDataDir: dataDir,
        createDatabase: client.factory,
      });

      expect(drift.status).toBe("mismatch");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
