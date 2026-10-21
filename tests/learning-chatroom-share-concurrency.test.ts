import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readLearningChatroomSharesSnapshot,
  replaceLearningChatroomSharesSnapshot,
} from "@/lib/server/external-storage-route-share-store";
import {
  createEmptyLearningChatroomShareDatabase,
  createLearningChatroomShare,
  readLearningChatroomShareDatabase,
  revokeLearningChatroomShare,
  type LearningChatroomShareRecord,
} from "@/lib/server/learning-chatroom-share-store";

const fileHooks = vi.hoisted(() => ({
  beforeWrite: undefined as (() => Promise<void>) | undefined,
  onMkdir: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mocked = {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      fileHooks.onMkdir?.();
      return actual.mkdir(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await fileHooks.beforeWrite?.();
      return actual.writeFile(...args);
    },
  };
  return { ...mocked, default: mocked };
});

const fixtureDirs: string[] = [];
const now = "2026-09-30T10:00:00.000Z";
const revokedAt = "2026-09-30T10:01:00.000Z";

afterEach(async () => {
  fileHooks.beforeWrite = undefined;
  fileHooks.onMkdir = undefined;
  await Promise.all(fixtureDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createFixtureDir() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-share-concurrency-"));
  fixtureDirs.push(dataDir);
  return dataDir;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Hold the first write before its temp file is published. The second writer's
// first mkdir is an observable boundary on both implementations: without a
// lock it has already read the stale database; with a lock it has yet to read.
// This forces the old lost-update schedule without sleeps or probabilistic load.
function pauseFirstWrite() {
  const paused = deferred();
  const release = deferred();
  fileHooks.beforeWrite = async () => {
    fileHooks.beforeWrite = undefined;
    paused.resolve();
    await release.promise;
  };
  return { paused: paused.promise, release: release.resolve };
}

function observeNextMkdir() {
  const entered = deferred();
  fileHooks.onMkdir = () => {
    fileHooks.onMkdir = undefined;
    entered.resolve();
  };
  return entered.promise;
}

function createShare(shareId: string): LearningChatroomShareRecord {
  return {
    shareId,
    courseId: "course-concurrency",
    createdBy: "synthetic-student",
    createdAt: now,
    expiresAt: "2026-10-14T10:00:00.000Z",
    storagePolicy: "external-redacted-learning-chatroom-shares",
    storageWritePolicy: "external-optimistic-snapshot-replace",
    responsibleSession: "S12",
    redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
  };
}

describe("share snapshot concurrency", () => {
  it("releases the external share lock after a failed write", async () => {
    const dataDir = await createFixtureDir();
    const database = { ...createEmptyLearningChatroomShareDatabase(), shares: [createShare("share-retry")] };
    fileHooks.beforeWrite = async () => {
      fileHooks.beforeWrite = undefined;
      throw new Error("synthetic write failure");
    };
    await expect(replaceLearningChatroomSharesSnapshot({
      dataDir, expectedRevision: "rev-empty", database,
    })).rejects.toThrow("synthetic write failure");

    await replaceLearningChatroomSharesSnapshot({ dataDir, expectedRevision: "rev-empty", database });
    expect((await readLearningChatroomSharesSnapshot(dataDir)).database.shares).toEqual(database.shares);
  });

  it("releases the local share lock after a failed write", async () => {
    const dataDir = await createFixtureDir();
    const input = {
      dataDir, shareId: "share-retry", courseId: "course-concurrency",
      createdBy: "synthetic-student", now,
    };
    fileHooks.beforeWrite = async () => {
      fileHooks.beforeWrite = undefined;
      throw new Error("synthetic write failure");
    };
    await expect(createLearningChatroomShare(input)).rejects.toThrow("synthetic write failure");

    await createLearningChatroomShare(input);
    expect((await readLearningChatroomShareDatabase({ dataDir })).shares[0]?.shareId).toBe(input.shareId);
  });

  it("rejects a stale external mint racing a share revocation", async () => {
    const dataDir = await createFixtureDir();
    const share = createShare("share-revoke");
    const initial = { ...createEmptyLearningChatroomShareDatabase(), updatedAt: now, shares: [share] };
    await replaceLearningChatroomSharesSnapshot({ dataDir, expectedRevision: "rev-empty", database: initial });
    const snapshot = await readLearningChatroomSharesSnapshot(dataDir);
    const gate = pauseFirstWrite();
    const revocation = replaceLearningChatroomSharesSnapshot({
      dataDir,
      expectedRevision: snapshot.revision,
      database: { ...initial, updatedAt: revokedAt, shares: [{ ...share, revokedAt }] },
    });
    await gate.paused;
    const secondEntered = observeNextMkdir();
    const mint = replaceLearningChatroomSharesSnapshot({
      dataDir,
      expectedRevision: snapshot.revision,
      database: { ...initial, shares: [share, createShare("share-new")] },
    });
    const results = Promise.allSettled([revocation, mint]);
    await secondEntered;
    gate.release();

    const [revoked, staleMint] = await results;
    expect(revoked.status).toBe("fulfilled");
    expect(staleMint).toMatchObject({ status: "rejected", reason: { status: 409 } });
    const final = await readLearningChatroomSharesSnapshot(dataDir);
    expect(final.database.shares).toEqual([{ ...share, revokedAt }]);
  });

  it("preserves both a local revocation and a concurrently minted link", async () => {
    const dataDir = await createFixtureDir();
    await createLearningChatroomShare({
      dataDir, shareId: "share-revoke", courseId: "course-concurrency",
      createdBy: "synthetic-student", now,
    });
    const gate = pauseFirstWrite();
    const revocation = revokeLearningChatroomShare({ dataDir, shareId: "share-revoke", now: revokedAt });
    await gate.paused;
    const secondEntered = observeNextMkdir();
    const mint = createLearningChatroomShare({
      dataDir, shareId: "share-new", courseId: "course-concurrency",
      createdBy: "synthetic-student", now: revokedAt,
    });
    const results = Promise.all([revocation, mint]);
    await secondEntered;
    gate.release();
    await results;

    const final = await readLearningChatroomShareDatabase({ dataDir });
    expect(final.shares.map((share) => share.shareId)).toEqual(["share-revoke", "share-new"]);
    expect(final.shares.find((share) => share.shareId === "share-revoke")?.revokedAt).toBe(revokedAt);
  });
});
