import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { runInNewContext } from "node:vm";
import { Readable } from "node:stream";
import * as fileSystem from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyTeachingCourseAssetsDatabase,
  createEmptyTeachingCourseManagementDatabase,
  normalizeTeachingOperationAuditEvent,
  normalizeTeachingOperationRecord,
} from "@/lib/server/external-storage-serialization";

const hooks = vi.hoisted(() => ({
  beforeWrite: undefined as (() => Promise<void>) | undefined,
  onMkdir: undefined as (() => void) | undefined,
  failAuditAppend: false,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mocked = {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      hooks.onMkdir?.();
      return actual.mkdir(...args);
    },
    appendFile: async (...args: Parameters<typeof actual.appendFile>) => {
      if (hooks.failAuditAppend && String(args[0]).includes("teaching-operations-audit")) {
        hooks.failAuditAppend = false;
        throw new Error("synthetic audit append failure");
      }
      await hooks.beforeWrite?.();
      return actual.appendFile(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await hooks.beforeWrite?.();
      return actual.writeFile(...args);
    },
  };
  return { ...mocked, default: mocked };
});

const dirs: string[] = [];
afterEach(async () => {
  hooks.beforeWrite = undefined;
  hooks.onMkdir = undefined;
  hooks.failAuditAppend = false;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "uais-external-independent-"));
  dirs.push(dir);
  return dir;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function pauseFirstWrite() {
  const paused = deferred();
  const release = deferred();
  hooks.beforeWrite = async () => {
    hooks.beforeWrite = undefined;
    paused.resolve();
    await release.promise;
  };
  return { paused: paused.promise, release: release.resolve };
}
function observeMkdir() {
  const entered = deferred();
  hooks.onMkdir = () => { hooks.onMkdir = undefined; entered.resolve(); };
  return entered.promise;
}
async function routeStores() {
  vi.resetModules();
  const first = await import("@/lib/server/external-storage-route-store");
  vi.resetModules();
  const second = await import("@/lib/server/external-storage-route-store");
  expect(first.appendTeachingOperation).not.toBe(second.appendTeachingOperation);
  return [first, second] as const;
}
async function standaloneStores() {
  const source = await readFile(join(process.cwd(), "scripts/external-storage-service.mjs"), "utf8");
  // Execute the supported standalone persistence implementation in independent
  // VM contexts. Remove only imports and CLI startup, so the probe never opens
  // a server or reads environment configuration. Its actual function bodies run
  // against the same isolated filesystem fixture as the route implementation.
  const startupStart = source.indexOf("try {\n  const options = parseArgs(");
  const startupEnd = source.indexOf("function createExternalStorageServer(config)");
  expect(startupStart).toBeGreaterThan(0);
  expect(startupEnd).toBeGreaterThan(startupStart);
  const executable = (source.slice(0, startupStart) + source.slice(startupEnd))
    .replace(/^#!.*\n/, "").replace(/^import .*;\n/gm, "");
  const load = () => runInNewContext(`${executable}\n({
    appendTeachingOperation, listTeachingOperationAuditEvents, createExternalStorageServer, readTeacherOwnership,
    rollbackTeachingOperation, listTeachingOperationRollbackRecords,
    replaceTeachingCourseManagementSnapshot, readTeachingCourseManagementSnapshot,
    replaceTeachingCourseAssetsSnapshot, readTeachingCourseAssetsSnapshot,
  });`, { ...fileSystem, createHash, randomUUID, timingSafeEqual, resolve, setTimeout, Buffer, URL,
    createServer: (handler: unknown) => handler,
  }) as
    Pick<Awaited<ReturnType<typeof routeStores>>[0],
      "appendTeachingOperation" | "listTeachingOperationAuditEvents" | "rollbackTeachingOperation" | "listTeachingOperationRollbackRecords" |
      "replaceTeachingCourseManagementSnapshot" | "readTeachingCourseManagementSnapshot" |
      "replaceTeachingCourseAssetsSnapshot" | "readTeachingCourseAssetsSnapshot" | "readTeacherOwnership"> & {
        createExternalStorageServer(config: Record<string, unknown>): (request: object, response: object) => Promise<void>;
      };
  return [load(), load()] as const;
}
const redaction = { secrets: "omitted", localFiles: "omitted", assets: "ids-only" };
function record(recordId: string) {
  return normalizeTeachingOperationRecord({
    recordId, operationId: "course-settings", actionSlot: "primary", actionId: "save-course-settings",
    actorId: "synthetic-teacher", courseId: "synthetic-course", createdAt: "2026-06-23T10:00:00.000Z",
    status: "persisted", storagePolicy: "external-redacted-teaching-operation-append",
    storageWritePolicy: "external-append-only-operation-log", redaction, artifacts: [], domainProjections: [],
  });
}
function audit() {
  return normalizeTeachingOperationAuditEvent({
    auditId: "synthetic-audit", traceId: "synthetic-trace", eventType: "teaching-operation.persisted",
    actorId: "synthetic-teacher", actorRole: "teacher", authMode: "signed-teacher-session",
    operationId: "course-settings", actionSlot: "primary", actionId: "save-course-settings",
    courseId: "synthetic-course", createdAt: "2026-06-23T10:00:00.000Z", redaction,
    requestSource: { userAgent: "synthetic-test", ipAddress: "redacted" },
  });
}

describe.each([
  { runtime: "route", stores: routeStores },
  { runtime: "standalone", stores: standaloneStores },
])("independent $runtime external store concurrency", ({ stores }) => {
  it("persists an idempotent operation and audit once across module instances", async () => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    const input = { dataDir, teacherId: "synthetic-teacher", record: record("synthetic-same"), auditEvent: audit() };
    const pause = pauseFirstWrite();
    const first = a.appendTeachingOperation(input);
    await pause.paused;
    const entered = observeMkdir();
    const second = b.appendTeachingOperation(input);
    await entered;
    pause.release();
    const results = await Promise.all([first, second]);
    expect.soft(results.map((r) => r.idempotencyStatus).sort()).toEqual(["already-persisted", "created"]);
    expect.soft((await readFile(join(dataDir, "teaching-operations", "synthetic-teacher.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    expect.soft((await readFile(join(dataDir, "teaching-operations-audit", "synthetic-teacher.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("assigns distinct ordered append sequences across module instances", async () => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    const pause = pauseFirstWrite();
    const first = a.appendTeachingOperation({ dataDir, teacherId: "synthetic-teacher", record: record("synthetic-first") });
    await pause.paused;
    const entered = observeMkdir();
    const second = b.appendTeachingOperation({ dataDir, teacherId: "synthetic-teacher", record: record("synthetic-second") });
    await entered;
    pause.release();
    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.appendSequence).sort()).toEqual([1, 2]);
  });

  it("rejects conflicting concurrent reuse of an operation id", async () => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    const input = { dataDir, teacherId: "synthetic-teacher", record: record("synthetic-conflict") };
    const pause = pauseFirstWrite();
    const first = a.appendTeachingOperation(input);
    await pause.paused;
    const entered = observeMkdir();
    const second = b.appendTeachingOperation({ ...input, record: { ...input.record, courseId: "synthetic-other-course" } });
    const resultsPromise = Promise.allSettled([first, second]);
    await entered;
    pause.release();
    const results = await resultsPromise;
    expect(results[0]).toMatchObject({ status: "fulfilled" });
    expect(results[1]).toMatchObject({ status: "rejected", reason: { status: 409 } });
    const lines = (await readFile(join(dataDir, "teaching-operations", "synthetic-teacher.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).record.courseId).toBe("synthetic-course");
  });

  it.each([
    { kind: "course management", seeded: false }, { kind: "course management", seeded: true },
    { kind: "course assets", seeded: false }, { kind: "course assets", seeded: true },
  ])("rejects the stale concurrent $kind snapshot (seeded=$seeded)", async ({ kind, seeded }) => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    let expectedRevision = "rev-empty";
    const replace = (store: typeof a, updatedAt: string) => kind === "course management"
      ? store.replaceTeachingCourseManagementSnapshot({ dataDir, expectedRevision, database: { ...createEmptyTeachingCourseManagementDatabase(), updatedAt } })
      : store.replaceTeachingCourseAssetsSnapshot({ dataDir, expectedRevision, database: { ...createEmptyTeachingCourseAssetsDatabase(), updatedAt } });
    if (seeded) expectedRevision = (await replace(a, "2026-06-22T10:00:00.000Z")).revision;
    const pause = pauseFirstWrite();
    const first = replace(a, "2026-06-23T10:00:00.000Z");
    await pause.paused;
    const entered = observeMkdir();
    const second = replace(b, "2026-06-23T11:00:00.000Z");
    const resultsPromise = Promise.allSettled([first, second]);
    await entered;
    pause.release();
    const results = await resultsPromise;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const final = await (kind === "course management" ? a.readTeachingCourseManagementSnapshot(dataDir) : a.readTeachingCourseAssetsSnapshot(dataDir));
    expect(final.database.updatedAt).toBe("2026-06-23T10:00:00.000Z");
  });

  it("retains the original audit event after an audit append failure and retry", async () => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    const originalAudit = audit();
    const input = { dataDir, teacherId: "synthetic-teacher", record: record("synthetic-retry"), auditEvent: originalAudit };
    hooks.failAuditAppend = true;
    await expect(a.appendTeachingOperation(input)).rejects.toThrow("synthetic audit append failure");
    const retries = await Promise.all([a, b].map((store) => store.appendTeachingOperation({
      ...input, auditEvent: { ...originalAudit, traceId: "synthetic-retry-trace" },
    })));
    expect(retries).toEqual([
      { idempotencyStatus: "already-persisted", appendSequence: 1 },
      { idempotencyStatus: "already-persisted", appendSequence: 1 },
    ]);
    expect((await a.listTeachingOperationAuditEvents(dataDir, "synthetic-teacher")).events).toEqual([originalAudit]);
  });

  it.each(["append", "course management", "course assets"])("releases the %s lock after a failed write", async (kind) => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    const write = (store: typeof a) => kind === "append"
      ? store.appendTeachingOperation({ dataDir, teacherId: "synthetic-teacher", record: record("synthetic-recovery") })
      : kind === "course management"
        ? store.replaceTeachingCourseManagementSnapshot({ dataDir, expectedRevision: "rev-empty", database: createEmptyTeachingCourseManagementDatabase() })
        : store.replaceTeachingCourseAssetsSnapshot({ dataDir, expectedRevision: "rev-empty", database: createEmptyTeachingCourseAssetsDatabase() });
    hooks.beforeWrite = async () => { hooks.beforeWrite = undefined; throw new Error("synthetic write failure"); };
    await expect(write(a)).rejects.toThrow("synthetic write failure");
    await expect(write(b)).resolves.toBeDefined();
  });

  it("repairs distinct original audit events that share a second-resolution audit id", async () => {
    const dataDir = await fixture();
    const [a] = await stores();
    const originalAudit = audit();
    await a.appendTeachingOperation({ dataDir, teacherId: "synthetic-teacher", record: record("synthetic-earlier"), auditEvent: originalAudit });
    const input = { dataDir, teacherId: "synthetic-teacher", record: record("synthetic-later"), auditEvent: { ...originalAudit, traceId: "synthetic-later-trace" } };
    hooks.failAuditAppend = true;
    await expect(a.appendTeachingOperation(input)).rejects.toThrow("synthetic audit append failure");
    await a.appendTeachingOperation(input);
    expect((await a.listTeachingOperationAuditEvents(dataDir, "synthetic-teacher")).events).toEqual([originalAudit, input.auditEvent]);
  });

  function rollbackInput(dataDir: string) {
    return { dataDir, teacherId: "synthetic-teacher", recordId: "synthetic-rollback", courseId: "synthetic-course",
      rollbackReason: "synthetic-test", traceId: "synthetic-original-rollback-trace", requestedAt: "2026-06-23T11:00:00.000Z",
      requestSource: { userAgent: "synthetic test", ipAddress: "redacted" as const },
    };
  }

  it("records one rollback and audit when independent workers roll back the same record", async () => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    await a.appendTeachingOperation({ dataDir, teacherId: "synthetic-teacher", record: record("synthetic-rollback") });
    const input = rollbackInput(dataDir);
    const pause = pauseFirstWrite();
    const first = a.rollbackTeachingOperation(input);
    await pause.paused;
    const entered = observeMkdir();
    const second = b.rollbackTeachingOperation(input);
    const resultsPromise = Promise.allSettled([first, second]);
    await entered;
    pause.release();
    const results = await resultsPromise;
    expect.soft(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect.soft(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    expect.soft(await a.listTeachingOperationRollbackRecords(dataDir, "synthetic-teacher")).toHaveLength(1);
    expect.soft((await a.listTeachingOperationAuditEvents(dataDir, "synthetic-teacher")).events).toHaveLength(1);
  });

  it("repairs a missing original rollback audit before preserving the repeat conflict", async () => {
    const dataDir = await fixture();
    const [a, b] = await stores();
    await a.appendTeachingOperation({ dataDir, teacherId: "synthetic-teacher", record: record("synthetic-rollback") });
    const input = rollbackInput(dataDir);
    hooks.failAuditAppend = true;
    await expect(a.rollbackTeachingOperation(input)).rejects.toThrow("synthetic audit append failure");
    await expect(b.rollbackTeachingOperation({ ...input, traceId: "synthetic-retry-rollback-trace" })).rejects.toMatchObject({ status: 409 });
    const events = (await a.listTeachingOperationAuditEvents(dataDir, "synthetic-teacher")).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ traceId: input.traceId, createdAt: input.requestedAt, eventType: "teaching-operation.rolled-back" });
  });

  it("does not fabricate original audit evidence for legacy rollback rows", async () => {
    const dataDir = await fixture();
    const [a] = await stores();
    await a.appendTeachingOperation({ dataDir, teacherId: "synthetic-teacher", record: record("synthetic-rollback") });
    const input = rollbackInput(dataDir);
    hooks.failAuditAppend = true;
    await expect(a.rollbackTeachingOperation(input)).rejects.toThrow("synthetic audit append failure");
    const path = join(dataDir, "teaching-operation-rollbacks", "synthetic-teacher.jsonl");
    const legacyRow = JSON.parse(await readFile(path, "utf8"));
    delete legacyRow.auditEvent;
    await writeFile(path, `${JSON.stringify(legacyRow)}\n`);
    await expect(a.rollbackTeachingOperation({ ...input, traceId: "synthetic-new-trace" })).rejects.toMatchObject({ status: 409 });
    expect((await a.listTeachingOperationAuditEvents(dataDir, "synthetic-teacher")).events).toEqual([]);
  });
});

describe.each(["route", "standalone"])("%s external ownership merge", (runtime) => {
  it("preserves both concurrent course grants", async () => {
    const dataDir = await fixture();
    const teacherId = "synthetic-teacher";
    const accessToken = "synthetic-external-storage-test-token";
    const standalone = runtime === "standalone" ? await standaloneStores() : undefined;
    const service = runtime === "route" ? await import("@/lib/server/external-storage-route-service") : undefined;
    const merge = async (index: 0 | 1) => {
      const body = { action: "merge-teacher-ai-ownership", ownership: {
        teacherId, courseIds: [`synthetic-course-${index}`],
        sampleAssets: [], pptAssets: [], clonedVoiceRefs: [], audioManifests: [],
      } };
      if (service) {
        const handler = service.createExternalStorageTeacherOwnershipMergePostHandler({ env: {
          UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: accessToken,
          UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR: dataDir,
          UAIS_EXTERNAL_STORAGE_SERVICE_MODE: "reference",
        } });
        const result = await handler(new Request("https://synthetic.invalid/merge", {
          method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body),
        }), { params: { teacherId } });
        return result.status;
      }
      const handler = standalone![index].createExternalStorageServer({ dataDir, accessToken, host: "synthetic.invalid" });
      let status = 0;
      await handler(Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
        method: "POST", url: `/teacher-ai-ownership/${teacherId}/merge`,
        headers: { authorization: `Bearer ${accessToken}` },
      }), { writeHead: (value: number) => { status = value; }, end: () => undefined });
      return status;
    };
    const pause = pauseFirstWrite();
    const first = merge(0);
    await pause.paused;
    const entered = observeMkdir();
    const second = merge(1);
    await entered;
    pause.release();
    expect(await Promise.all([first, second])).toEqual([200, 200]);
    const stored = JSON.parse(await readFile(join(dataDir, "teacher-ai-ownership", `${teacherId}.json`), "utf8"));
    expect(stored.courseIds.sort()).toEqual(["synthetic-course-0", "synthetic-course-1"]);
  });
});
