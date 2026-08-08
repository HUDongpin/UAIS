import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createExternalStorageLearningChatroomSharesDatabaseGetHandler,
  createExternalStorageLearningChatroomSharesDatabasePutHandler,
} from "@/lib/server/external-storage-route-service";
import { createUaisLearningChatroomShareRepository } from "@/lib/server/learning-chatroom-share-external-store";
import {
  createEmptyLearningChatroomShareDatabase,
  createLearningChatroomShare,
  readLearningChatroomShare,
  type LearningChatroomShareDatabase,
} from "@/lib/server/learning-chatroom-share-store";
import { resolveLearningChatroomShareBackend } from "@/lib/server/learning-chatroom-share-runtime";

// Closes release blocker B1: the share store had a `repository` seam with no
// factory and no external-storage resource, so a deployed runtime always fell
// through to local JSON and refused itself - minting and the public page both
// failed closed in production while every local run passed.
//
// The suite drives the REAL service handlers over a temp data dir and the REAL
// client adapter over an injected fetch, so the two halves are proved against
// each other rather than against a mock of themselves.

const accessToken = "test-external-storage-route-token-strong";
const fixtureDirs: string[] = [];

afterAll(async () => {
  await Promise.all(fixtureDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createServiceFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-share-external-"));
  fixtureDirs.push(dataDir);
  const env = {
    UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
    UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR: dataDir,
  };
  return {
    dataDir,
    env,
    get: createExternalStorageLearningChatroomSharesDatabaseGetHandler({ env }),
    put: createExternalStorageLearningChatroomSharesDatabasePutHandler({ env }),
  };
}

function authorizedRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
  });
}

const databaseUrl = "https://storage.test/learning-chatroom-shares/database";

// Routes the adapter's fetch straight into the service handlers, so a test
// exercises the same request bodies, action slug and revisions a deployment
// would put on the wire.
function createLoopbackFetch(fixture: Awaited<ReturnType<typeof createServiceFixture>>) {
  const calls: Array<{ method: string; url: string }> = [];
  const loopback = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    const request = authorizedRequest(url, init);
    return method === "GET" ? fixture.get(request) : fixture.put(request);
  }) as unknown as typeof fetch;
  return { loopback, calls };
}

function createExternalEnv(extra: Record<string, string | undefined> = {}) {
  return {
    UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external",
    UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.test",
    UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
    ...extra,
  };
}

describe("external storage learning chatroom shares resource", () => {
  it("serves an empty snapshot before anything is written", async () => {
    const fixture = await createServiceFixture();
    const response = await fixture.get(authorizedRequest(databaseUrl));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.revision).toBe("rev-empty");
    expect(body.database.schemaVersion).toBe("uais-learning-chatroom-shares-v1");
    expect(body.database.shares).toEqual([]);
    expect(body.storagePolicy).toBe("external-redacted-learning-chatroom-shares");
    // The data directory is a server path and must never reach a caller.
    expect(JSON.stringify(body)).not.toContain(fixture.dataDir);
  });

  it("rejects an unauthorized caller before reading anything", async () => {
    const fixture = await createServiceFixture();
    const response = await fixture.get(new Request(databaseUrl));
    expect(response.status).toBe(401);
  });

  it("replaces the snapshot and enforces the expected revision", async () => {
    const fixture = await createServiceFixture();
    const database: LearningChatroomShareDatabase = {
      ...createEmptyLearningChatroomShareDatabase(),
      updatedAt: "2026-08-09T10:00:00.000Z",
      shares: [
        {
          shareId: "share-external000000000000000001",
          courseId: "course-1",
          groupId: "group-three",
          createdBy: "PeterChen",
          createdAt: "2026-08-09T10:00:00.000Z",
          storagePolicy: "external-redacted-learning-chatroom-shares",
          storageWritePolicy: "external-optimistic-snapshot-replace",
          responsibleSession: "S12",
          redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
        },
      ],
    };

    const written = await fixture.put(
      authorizedRequest(databaseUrl, {
        method: "PUT",
        body: JSON.stringify({
          action: "replace-learning-chatroom-shares-database",
          expectedRevision: "rev-empty",
          database,
        }),
      }),
    );
    const writtenBody = await written.json();
    expect(written.status).toBe(200);
    expect(writtenBody.status).toBe("persisted");
    expect(writtenBody.revision).not.toBe("rev-empty");

    // A second write against the stale revision is the optimistic-concurrency
    // signal the store retries on, not a silent clobber.
    const conflicted = await fixture.put(
      authorizedRequest(databaseUrl, {
        method: "PUT",
        body: JSON.stringify({
          action: "replace-learning-chatroom-shares-database",
          expectedRevision: "rev-empty",
          database,
        }),
      }),
    );
    expect(conflicted.status).toBe(409);

    const replayed = await fixture.get(authorizedRequest(databaseUrl));
    const replayedBody = await replayed.json();
    expect(replayedBody.database.shares).toHaveLength(1);
    expect(replayedBody.revision).toBe(writtenBody.revision);
  });

  it("refuses an unknown action", async () => {
    const fixture = await createServiceFixture();
    const response = await fixture.put(
      authorizedRequest(databaseUrl, {
        method: "PUT",
        body: JSON.stringify({ action: "replace-learning-chatroom-transcripts-database" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("learning chatroom share repository adapter", () => {
  it("round-trips a mint through the external resource", async () => {
    const fixture = await createServiceFixture();
    const { loopback, calls } = createLoopbackFetch(fixture);
    const repository = createUaisLearningChatroomShareRepository({
      env: createExternalEnv(),
      fetch: loopback,
    });
    expect(repository).toBeDefined();
    expect(repository?.storage.shareStoragePolicy).toBe(
      "external-redacted-learning-chatroom-shares",
    );

    // `dataDir` is irrelevant once a repository is present - the store must go
    // to the repository, which is exactly what a serverless runtime needs.
    const { record } = await createLearningChatroomShare({
      dataDir: join(fixture.dataDir, "unused-local"),
      env: createExternalEnv(),
      repository: repository!,
      shareId: "share-roundtrip00000000000000001",
      courseId: "course-1",
      groupId: "group-three",
      createdBy: "PeterChen",
      now: "2026-08-09T10:00:00.000Z",
    });

    const readBack = await readLearningChatroomShare({
      dataDir: join(fixture.dataDir, "unused-local"),
      env: createExternalEnv(),
      repository: repository!,
      shareId: record.shareId,
    });
    expect(readBack?.shareId).toBe("share-roundtrip00000000000000001");
    expect(readBack?.groupId).toBe("group-three");

    // Proves the traffic actually crossed the adapter rather than a local file.
    expect(calls.some((call) => call.method === "PUT")).toBe(true);
    expect(calls.every((call) => call.url === databaseUrl)).toBe(true);
  });

  it("refuses a production acknowledgement that omits evidence or the new revision", async () => {
    const env = createExternalEnv({ UAIS_DEPLOYMENT_ENV: "production" });
    const database = createEmptyLearningChatroomShareDatabase();
    const adapterProof = {
      status: "ready",
      providerClass: "managed-database",
      migrationStatus: "up-to-date",
      backupPolicy: "point-in-time-restore",
      concurrencyControl: "transactional",
      valueRedacted: true,
    };

    // A service that acks the write without naming the new snapshot revision has
    // not proved it swapped anything - treating that as success would hand the
    // learner a link to a record that was never stored.
    const missingRevision = createUaisLearningChatroomShareRepository({
      env,
      fetch: (async () =>
        Response.json({ productionDatabaseAdapter: adapterProof })) as unknown as typeof fetch,
    });
    await expect(
      missingRevision!.write({ database, expectedRevision: "rev-empty" }),
    ).rejects.toThrow(/missing snapshot revision/);

    // And evidence without the proof is refused for the same reason.
    const missingEvidence = createUaisLearningChatroomShareRepository({
      env,
      fetch: (async () => Response.json({ revision: "rev-abc" })) as unknown as typeof fetch,
    });
    await expect(
      missingEvidence!.write({ database, expectedRevision: "rev-empty" }),
    ).rejects.toThrow(/production database adapter evidence/);
  });

  it("is undefined for a local-json deployment and 503s for an unready external one", () => {
    expect(
      createUaisLearningChatroomShareRepository({ env: {} }),
    ).toBeUndefined();
    expect(
      createUaisLearningChatroomShareRepository({
        env: { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "local-json-file" },
      }),
    ).toBeUndefined();

    // Selector says external but nothing is configured: fail closed rather than
    // silently writing somewhere non-durable.
    expect(() =>
      createUaisLearningChatroomShareRepository({
        env: { UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND: "external" },
      }),
    ).toThrowError(/not ready|not configured/);
  });
});

describe("share backend resolution", () => {
  it("uses the external repository instead of refusing a production runtime", async () => {
    const fixture = await createServiceFixture();
    const { loopback } = createLoopbackFetch(fixture);
    const env = createExternalEnv({ UAIS_DEPLOYMENT_ENV: "production" });

    // Before B1 was fixed this threw: no factory meant the local-JSON guard ran
    // and production share links were impossible.
    const backend = resolveLearningChatroomShareBackend({ env, fetch: loopback });
    expect(backend.repository).toBeDefined();
    expect(backend.repository?.storage.storageWritePolicy).toBe(
      "external-optimistic-snapshot-replace",
    );
  });

  it("still refuses local JSON in a production runtime", () => {
    expect(() =>
      resolveLearningChatroomShareBackend({ env: { UAIS_DEPLOYMENT_ENV: "production" } }),
    ).toThrowError(/requires external storage/);
  });

  it("allows local JSON outside production", () => {
    const backend = resolveLearningChatroomShareBackend({ env: {} });
    expect(backend.repository).toBeUndefined();
    expect(backend.dataDir).toBeTruthy();
  });

  it("prefers an injected repository over the environment", () => {
    const injected = {
      storage: {
        shareStoragePolicy: "external-redacted-learning-chatroom-shares",
        storageWritePolicy: "external-optimistic-snapshot-replace",
      },
      read: async () => ({ database: createEmptyLearningChatroomShareDatabase() }),
      write: async () => undefined,
    } as const;

    const backend = resolveLearningChatroomShareBackend({
      env: { UAIS_DEPLOYMENT_ENV: "production" },
      repository: injected,
    });
    expect(backend.repository).toBe(injected);
  });
});
