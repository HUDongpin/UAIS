import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { QwenCourseCoverGenerateResult } from "@/lib/ai/providers/qwen-client";
import {
  readTeachingCourseAssetsDatabase,
  storeTeachingCourseCoverAsset,
} from "@/lib/server/teaching-course-assets-store";

const fileHooks = vi.hoisted(() => ({
  beforeWrite: undefined as (() => Promise<void>) | undefined,
  onMkdir: undefined as (() => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mocked = {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => { fileHooks.onMkdir?.(); return actual.mkdir(...args); },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => { await fileHooks.beforeWrite?.(); return actual.writeFile(...args); },
  };
  return { ...mocked, default: mocked };
});

const fixtureDirs: string[] = [];
afterEach(async () => {
  fileHooks.beforeWrite = undefined;
  fileHooks.onMkdir = undefined;
  await Promise.all(fixtureDirs.splice(0).map((dataDir) => rm(dataDir, { recursive: true, force: true })));
});

async function directory() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-local-cover-race-"));
  fixtureDirs.push(dataDir);
  return dataDir;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function store(dataDir: string, requestId: string, courseId = "course-a") {
  const cover: QwenCourseCoverGenerateResult = {
    provider: "qwen", providerRole: "image-generation", model: "synthetic-cover",
    imageUrl: `https://fixture.example.test/${requestId}.png`, requestId,
    redaction: { secrets: "omitted", localFiles: "omitted", assets: "generated-url-only" },
  };
  return storeTeachingCourseCoverAsset({
    dataDir, courseId, courseName: "Synthetic course", cover,
    createdAt: "2026-09-30T12:00:00.000Z",
    audit: {
      traceId: `trace-${requestId}`, actorId: "synthetic-teacher", actorRole: "teacher",
      authMode: "signed-teacher-session", requestSource: { userAgent: "Synthetic test", ipAddress: "redacted" },
    },
  });
}

it.each(["course-a", "course-b"])("preserves both assets and audits when simultaneous covers include %s", async (courseId) => {
  const dataDir = await directory();
  const paused = deferred();
  const release = deferred();
  fileHooks.beforeWrite = async () => {
    fileHooks.beforeWrite = undefined;
    paused.resolve();
    await release.promise;
  };
  const first = store(dataDir, "first");
  await paused.promise;
  const secondEntered = deferred();
  fileHooks.onMkdir = () => { fileHooks.onMkdir = undefined; secondEntered.resolve(); };
  const second = store(dataDir, "second", courseId);
  const results = Promise.all([first, second]);
  await secondEntered.promise;
  release.resolve();
  const receipts = await results;

  const database = await readTeachingCourseAssetsDatabase({ dataDir });
  expect(database.assets.map((asset) => asset.assetId).sort()).toEqual(receipts.map((receipt) => receipt.asset.assetId).sort());
  expect(database.auditEvents.map((audit) => audit.assetId).sort()).toEqual(receipts.map((receipt) => receipt.asset.assetId).sort());
  expect(database.auditEvents.map((audit) => audit.traceId).sort()).toEqual(["trace-first", "trace-second"]);
});

it("releases the local mutation lock after persistence fails", async () => {
  const dataDir = await directory();
  fileHooks.beforeWrite = async () => {
    fileHooks.beforeWrite = undefined;
    throw new Error("synthetic cover write failure");
  };
  await expect(store(dataDir, "failed")).rejects.toThrow("synthetic cover write failure");
  const receipt = await store(dataDir, "retry");
  const database = await readTeachingCourseAssetsDatabase({ dataDir });
  expect(database.assets.map((asset) => asset.assetId)).toEqual([receipt.asset.assetId]);
  expect(database.auditEvents.map((audit) => audit.assetId)).toEqual([receipt.asset.assetId]);
});

it("does not serialize independent local directories behind one blocked write", async () => {
  const firstDir = await directory();
  const secondDir = await directory();
  const paused = deferred();
  const release = deferred();
  fileHooks.beforeWrite = async () => {
    fileHooks.beforeWrite = undefined;
    paused.resolve();
    await release.promise;
  };
  const first = store(firstDir, "first");
  await paused.promise;
  try {
    const second = await store(secondDir, "second");
    expect((await readTeachingCourseAssetsDatabase({ dataDir: secondDir })).assets.map((asset) => asset.assetId)).toEqual([second.asset.assetId]);
  } finally {
    release.resolve();
    await first;
  }
});
