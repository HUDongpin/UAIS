import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetUaisCoreDatabasePoolForTesting } from "@/lib/db/core-database";
import {
  createEmptyLearningChatroomShareDatabase,
  isLearningChatroomShareActive,
  normalizeLearningChatroomShareDatabase,
  type LearningChatroomShareDatabase,
} from "@/lib/server/learning-chatroom-share-store";
import { createUaisLearningChatroomSharePostgresRepository } from "@/lib/server/learning-chatroom-share-postgres-store";
import {
  createLearningChatroomTranscriptId,
  normalizeLearningChatroomTranscriptDatabase,
  type LearningChatroomTranscriptDatabase,
} from "@/lib/server/learning-chatroom-transcript-store";
import { createUaisLearningChatroomTranscriptPostgresRepository } from "@/lib/server/learning-chatroom-transcript-postgres-store";
import { authorizeLiveDatabaseTestFile } from "../scripts/run-db-tests.mjs";

// Real-Postgres coverage for the two chatroom adapters.
//
// tests/learning-chatroom-postgres-store.test.ts drives these repositories with
// a recording client, which proves which statements they issue. It cannot prove
// what Postgres does with them - that the per-room re-key really isolates two
// rooms, that the revision guard really rejects a stale writer, that two members
// opening the same room in the same instant really cannot both insert. Those are
// properties of the database, so they need the database.
//
const authorization = await authorizeLiveDatabaseTestFile({
  env: process.env,
  lane: "legacy",
  testFile: "tests/learning-chatroom-postgres-integration.test.ts",
});
if (authorization.exitCode !== 0) {
  throw new Error(`UAIS_DB_TEST ${JSON.stringify(authorization.report)}`);
}
const databaseUrl = authorization.databaseUrl ?? "";

describe("learning-chatroom Postgres adapters (integration)", () => {
  const env = { UAIS_CORE_DATABASE_URL: databaseUrl };

  // The migration runner itself, not a copy of its SQL. A suite that applied its
  // own CREATE TABLEs would pass against a schema no deployment has.
  beforeAll(async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(process.execPath, ["scripts/apply-core-migrations.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, UAIS_CORE_DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv,
    });
  }, 180_000);

  // The stores borrow a module-scoped pool. Dropping it here stops this file
  // from leaking connections into the rest of a run.
  afterAll(async () => {
    await resetUaisCoreDatabasePoolForTesting();
  });

  // A room nobody has written before, so "the row does not exist yet" is a real
  // state rather than an assumption about a database that outlives the suite.
  function createRoomKey(prefix: string) {
    return createLearningChatroomTranscriptId({
      courseId: "elementary-math-research",
      classId: "elementary-math-research-class-1",
      studentId: `${prefix}-${randomUUID()}`,
    });
  }

  function buildTranscriptDatabase(input: {
    transcriptId: string;
    studentId: string;
    content: string;
    updatedAt: string;
  }): LearningChatroomTranscriptDatabase {
    return normalizeLearningChatroomTranscriptDatabase({
      schemaVersion: "uais-learning-chatroom-transcripts-v2",
      updatedAt: input.updatedAt,
      transcripts: [
        {
          transcriptId: input.transcriptId,
          courseId: "elementary-math-research",
          classId: "elementary-math-research-class-1",
          studentId: input.studentId,
          messages: [
            {
              messageId: `message-${input.transcriptId}-1`,
              role: "student",
              content: input.content,
              createdAt: input.updatedAt,
            },
          ],
          createdAt: "2026-08-16T09:00:00.000Z",
          updatedAt: input.updatedAt,
          storagePolicy: "postgres-learning-chatroom-transcripts",
          storageWritePolicy: "postgres-transactional-snapshot-replace",
          responsibleSession: "S12",
          redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
        },
      ],
    });
  }

  describe("transcripts", () => {
    it("round-trips one room's row and reads it back with parity", async () => {
      const repository = createUaisLearningChatroomTranscriptPostgresRepository({ env });
      const transcriptId = createRoomKey("round-trip");
      const database = buildTranscriptDatabase({
        transcriptId,
        studentId: "Alice",
        content: "第一条消息",
        updatedAt: "2026-08-16T09:05:00.000Z",
      });

      const before = await repository.read({ transcriptId });
      expect(before.database.transcripts).toHaveLength(0);
      expect(before.revision).toBeUndefined();

      await repository.write({ database, transcriptId });
      const snapshot = await repository.read({ transcriptId });

      expect(snapshot.database).toEqual(database);
      expect(snapshot.revision).toBeTruthy();
    });

    it("keeps two rooms out of each other's rows and still merges a corpus read", async () => {
      const repository = createUaisLearningChatroomTranscriptPostgresRepository({ env });
      const firstId = createRoomKey("isolation-first");
      const secondId = createRoomKey("isolation-second");
      const first = buildTranscriptDatabase({
        transcriptId: firstId,
        studentId: "Alice",
        content: "第一个房间",
        updatedAt: "2026-08-16T09:10:00.000Z",
      });
      const second = buildTranscriptDatabase({
        transcriptId: secondId,
        studentId: "Bob",
        content: "第二个房间",
        updatedAt: "2026-08-16T09:11:00.000Z",
      });

      await repository.write({ database: first, transcriptId: firstId });
      const firstAfterOwnWrite = await repository.read({ transcriptId: firstId });
      await repository.write({ database: second, transcriptId: secondId });

      // The second room's write moved neither the first room's contents nor its
      // revision, which is the whole point of the per-room re-key: a member of
      // one room can never lose an append to a writer they share nothing with.
      const firstAfterSecondWrite = await repository.read({ transcriptId: firstId });
      expect(firstAfterSecondWrite.database).toEqual(first);
      expect(firstAfterSecondWrite.revision).toBe(firstAfterOwnWrite.revision);

      const corpus = await repository.read();
      expect(corpus.database.transcripts.map((item) => item.transcriptId)).toEqual(
        expect.arrayContaining([firstId, secondId]),
      );
      // No single row backs a corpus read, so it carries no revision to guard.
      expect(corpus.revision).toBeUndefined();
    });

    it("rejects a write with a stale expectedRevision and leaves the row alone", async () => {
      const repository = createUaisLearningChatroomTranscriptPostgresRepository({ env });
      const transcriptId = createRoomKey("stale-revision");
      const stored = buildTranscriptDatabase({
        transcriptId,
        studentId: "Alice",
        content: "保留的消息",
        updatedAt: "2026-08-16T09:20:00.000Z",
      });

      await repository.write({ database: stored, transcriptId });
      const persisted = await repository.read({ transcriptId });
      expect(persisted.revision).toBeTruthy();

      await expect(
        repository.write({
          database: buildTranscriptDatabase({
            transcriptId,
            studentId: "Alice",
            content: "不应写入",
            updatedAt: "2026-08-16T09:21:00.000Z",
          }),
          transcriptId,
          expectedRevision: "rev-stale-000000000000000000000000",
        }),
      ).rejects.toMatchObject({ status: 409 });

      const afterConflict = await repository.read({ transcriptId });
      expect(afterConflict.revision).toBe(persisted.revision);
      expect(afterConflict.database.transcripts[0]?.messages[0]?.content).toBe("保留的消息");
    });

    // The window FOR UPDATE cannot close: a lock on a row that does not exist
    // yet locks nothing, so two members opening the same room at the same
    // instant both read "no row" and both try to insert. Exactly one may win.
    it("lets only one of two simultaneous first writes create the room", async () => {
      const repository = createUaisLearningChatroomTranscriptPostgresRepository({ env });
      const transcriptId = createRoomKey("first-write-race");

      const results = await Promise.allSettled([
        repository.write({
          database: buildTranscriptDatabase({
            transcriptId,
            studentId: "Alice",
            content: "同时开门 A",
            updatedAt: "2026-08-16T09:30:00.000Z",
          }),
          transcriptId,
        }),
        repository.write({
          database: buildTranscriptDatabase({
            transcriptId,
            studentId: "Bob",
            content: "同时开门 B",
            updatedAt: "2026-08-16T09:30:00.000Z",
          }),
          transcriptId,
        }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({
        status: 409,
      });

      // The loser's content is not in the row, and the room exists exactly once.
      const snapshot = await repository.read({ transcriptId });
      expect(snapshot.database.transcripts).toHaveLength(1);
      expect(snapshot.revision).toBeTruthy();
    });
  });

  describe("shares", () => {
    function buildShareDatabase(
      shares: {
        shareId: string;
        createdAt: string;
        expiresAt: string;
        revokedAt?: string;
      }[],
    ): LearningChatroomShareDatabase {
      return normalizeLearningChatroomShareDatabase({
        ...createEmptyLearningChatroomShareDatabase(),
        updatedAt: "2026-08-16T09:40:00.000Z",
        shares: shares.map((share) => ({
          shareId: share.shareId,
          courseId: "elementary-math-research",
          classId: "elementary-math-research-class-1",
          groupId: "group-one",
          createdBy: "Alice",
          createdAt: share.createdAt,
          expiresAt: share.expiresAt,
          ...(share.revokedAt ? { revokedAt: share.revokedAt } : {}),
          storagePolicy: "postgres-learning-chatroom-shares",
          storageWritePolicy: "postgres-transactional-snapshot-replace",
          responsibleSession: "S12",
          redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
        })),
      });
    }

    // One global row by decision (0006 deliberately left shares unsplit), so this
    // suite owns it for the length of the test and rewrites it whole.
    it("round-trips a minted link, an expired one, and a revocation", async () => {
      const repository = createUaisLearningChatroomSharePostgresRepository({ env });
      const liveShareId = `chatroom-share-live-${randomUUID().replace(/-/g, "")}`;
      const expiredShareId = `chatroom-share-expired-${randomUUID().replace(/-/g, "")}`;
      const minted = buildShareDatabase([
        {
          shareId: liveShareId,
          createdAt: "2026-08-16T09:00:00.000Z",
          expiresAt: "2026-08-30T09:00:00.000Z",
        },
        {
          shareId: expiredShareId,
          createdAt: "2026-07-01T09:00:00.000Z",
          expiresAt: "2026-07-15T09:00:00.000Z",
        },
      ]);

      const before = await repository.read();
      await repository.write({
        database: minted,
        ...(before.revision ? { expectedRevision: before.revision } : {}),
      });
      const persisted = await repository.read();
      expect(persisted.revision).toBeTruthy();

      const nowMs = Date.parse("2026-08-16T10:00:00.000Z");
      const live = persisted.database.shares.find((share) => share.shareId === liveShareId);
      const expired = persisted.database.shares.find(
        (share) => share.shareId === expiredShareId,
      );
      expect(isLearningChatroomShareActive(live, { nowMs })).toBe(true);
      // Expiry survives the round trip through jsonb, so a link nobody revoked
      // still stops publishing the room by itself.
      expect(isLearningChatroomShareActive(expired, { nowMs })).toBe(false);

      const revoked = normalizeLearningChatroomShareDatabase({
        ...persisted.database,
        updatedAt: "2026-08-16T10:00:00.000Z",
        shares: persisted.database.shares.map((share) =>
          share.shareId === liveShareId
            ? { ...share, revokedAt: "2026-08-16T10:00:00.000Z" }
            : share,
        ),
      });
      await repository.write({
        database: revoked,
        ...(persisted.revision ? { expectedRevision: persisted.revision } : {}),
      });

      const afterRevoke = await repository.read();
      expect(afterRevoke.revision).not.toBe(persisted.revision);
      expect(
        isLearningChatroomShareActive(
          afterRevoke.database.shares.find((share) => share.shareId === liveShareId),
          { nowMs },
        ),
      ).toBe(false);
    });

    it("rejects a share write with a stale expectedRevision", async () => {
      const repository = createUaisLearningChatroomSharePostgresRepository({ env });
      const shareId = `chatroom-share-guard-${randomUUID().replace(/-/g, "")}`;
      const before = await repository.read();
      await repository.write({
        database: buildShareDatabase([
          {
            shareId,
            createdAt: "2026-08-16T09:00:00.000Z",
            expiresAt: "2026-08-30T09:00:00.000Z",
          },
        ]),
        ...(before.revision ? { expectedRevision: before.revision } : {}),
      });
      const persisted = await repository.read();

      await expect(
        repository.write({
          database: createEmptyLearningChatroomShareDatabase(),
          expectedRevision: "rev-stale-000000000000000000000000",
        }),
      ).rejects.toMatchObject({ status: 409 });

      const afterConflict = await repository.read();
      expect(afterConflict.revision).toBe(persisted.revision);
      expect(afterConflict.database.shares.map((share) => share.shareId)).toContain(shareId);
    });
  });
});
