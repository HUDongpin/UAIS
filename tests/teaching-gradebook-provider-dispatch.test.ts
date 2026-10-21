import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTeachingGradebookReleaseRollbackPostHandler } from "@/app/api/teaching/gradebook-updates/[objectId]/rollback/handler";
import { createTeachingGradebookReleasePostHandler } from "@/app/api/teaching/gradebook-updates/[objectId]/release/handler";
import { createTeachingOperationAuditGetHandler } from "@/app/api/teaching/operations/audit/handler";
import { createUaisTeacherAuthSessionCookieHeader } from "@/lib/server/teacher-auth-session";
import { storeUaisTeacherAiOwnershipRecord } from "@/lib/server/teacher-ai-ownership-store";
import * as operations from "@/lib/server/teaching-operations-store";
import { claimGradebookProviderOperation, readGradebookProviderOperations } from "@/lib/server/teaching-gradebook-provider-operations";
import { gradebookProviderGeneration } from "@/lib/server/teaching-gradebook-provider-generation";
import type { TeachingOperationRepository } from "@/lib/server/teaching-operations-postgres-store";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const now = new Date("2026-06-22T11:00:00Z");
const audit = { traceId: "trace-provider-fixture", actorRole: "teacher" as const, authMode: "signed-teacher-session" as const, requestSource: { userAgent: "Synthetic provider operation regression", ipAddress: "redacted" as const } };
const objectId = "gradebook-update-course-a";
function gate() { let release!: () => void; const promise = new Promise<void>((done) => { release = done; }); return { release, promise }; }
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "uais-provider-intent-")); directories.push(dataDir);
  const secret = "synthetic-provider-operation-session-secret";
  const env = { UAIS_TEACHING_OPERATIONS_DATA_DIR: dataDir, UAIS_TEACHER_AI_OWNERSHIP_DIR: join(dataDir, "ownership"), UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET: secret, UAIS_GRADEBOOK_RELEASE_PROVIDER: "external", UAIS_GRADEBOOK_RELEASE_PROVIDER_URL: "https://provider.example.test/rollback", UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN: "synthetic-provider-token-at-least-32-characters" };
  await storeUaisTeacherAiOwnershipRecord({ baseDir: env.UAIS_TEACHER_AI_OWNERSHIP_DIR, ownership: { teacherId: "teacher-a", courseIds: ["course-a"] } });
  const grade = (at: Date) => operations.executeTeachingOperationAction({ dataDir, operationId: "grading", actionSlot: "primary", courseId: "course-a", actorId: "teacher-a", now: at });
  await grade(new Date("2026-06-22T10:00:00Z"));
  await operations.releaseTeachingGradebookUpdate({ dataDir, objectId, actorId: "teacher-a", audit, now: new Date("2026-06-22T10:30:00Z") });
  const cookie = createUaisTeacherAuthSessionCookieHeader({ secret, claims: { actorId: "teacher-a", role: "teacher", sessionId: "synthetic-session", authenticatedAt: "2026-06-22T10:00:00Z", expiresAt: "2026-06-22T12:00:00Z" } });
  const request = (method = "POST") => new Request(`https://example.test/api/teaching/gradebook-updates/${objectId}/rollback`, { method, headers: { cookie, "x-uais-trace-id": audit.traceId, "user-agent": audit.requestSource.userAgent } });
  const invoke = (handler: ReturnType<typeof createTeachingGradebookReleaseRollbackPostHandler>, method = "POST") => handler(request(method), { params: Promise.resolve({ objectId }) });
  return { env, dataDir, grade, request, invoke };
}
function repository(failAt?: number, commitBeforeFailure = false) {
  let database = operations.normalizeTeachingOperationDatabase({ schemaVersion: "uais-teaching-operations-v1" });
  let revision: string | undefined;
  let writes = 0;
  const store: TeachingOperationRepository = {
    read: async () => ({ database: structuredClone(database), revision }),
    write: async (input) => {
      if (input.expectedRevision !== revision) throw new operations.TeachingOperationStoreError(409, "CAS conflict");
      writes += 1;
      if (writes === failAt && !commitBeforeFailure) throw new Error("Synthetic lost acknowledgement");
      database = structuredClone(input.database); revision = `revision-${writes}`;
      if (writes === failAt) throw new Error("Synthetic lost acknowledgement");
    },
  };
  return store;
}

it("dispatches once across concurrent handlers and exposes the durable same operation after restart", async () => {
  const f = await fixture(); const entered = gate(); const finish = gate();
  const fetch = vi.fn(async () => { entered.release(); await finish.promise; return Response.json({ status: "release-rolled-back", rollbackId: "receipt-a" }); });
  const first = f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch }));
  await entered.promise;
  const second = await f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch }));
  const blocked = await second.json();
  expect(second.status).toBe(409); expect(blocked.providerOperation.phase).toBe("dispatching");
  finish.release(); expect((await first).status).toBe(200); expect(fetch).toHaveBeenCalledTimes(1);
  const readback = await f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch }), "GET");
  expect((await readback.json()).providerOperations).toContainEqual(expect.objectContaining({ operationId: blocked.providerOperation.operationId, phase: "succeeded", providerReceiptId: "receipt-a", actorRole: "teacher", authMode: "signed-teacher-session", requestSource: audit.requestSource }));
});

it.each(["network", "non-ok", "invalid-body"])("never repeats dispatch after %s uncertainty", async (kind) => {
  const f = await fixture();
  const fetch = vi.fn(async () => { if (kind === "network") throw new Error("Synthetic network loss"); return kind === "non-ok" ? Response.json({}, { status: 503 }) : Response.json({ status: "unexpected" }); });
  const handler = createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch });
  const first = await f.invoke(handler); expect(first.status).toBe(502);
  const id = (await first.json()).providerOperation.operationId;
  const second = await f.invoke(handler); expect(second.status).toBe(409);
  expect((await second.json()).providerOperation).toMatchObject({ operationId: id, phase: "reconciliation-required" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const release = await f.invoke(createTeachingGradebookReleasePostHandler({ env: f.env, now, fetch }));
  expect(release.status).toBe(409); expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not send when claim acknowledgement is lost after committing", async () => {
  const f = await fixture(); const claims = repository(1, true); const fetch = vi.fn();
  const handler = createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch, providerOperationsRepository: claims });
  expect((await f.invoke(handler)).status).toBe(500);
  expect((await f.invoke(handler)).status).toBe(409); expect(fetch).not.toHaveBeenCalled();
  expect((await readGradebookProviderOperations({ env: f.env, repository: claims }))[0].phase).toBe("dispatching");
});

it.each([2, 3])("never sends again after provider success and journal write %s fails", async (failAt) => {
  const f = await fixture(); const claims = repository(failAt); const fetch = vi.fn(async () => Response.json({ status: "release-rolled-back", rollbackId: "receipt-a" }));
  const handler = createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch, providerOperationsRepository: claims });
  expect((await f.invoke(handler)).status).toBe(502);
  const retry = await f.invoke(handler); expect(retry.status).toBe(409); expect(fetch).toHaveBeenCalledTimes(1);
  const records = await readGradebookProviderOperations({ env: f.env, repository: claims });
  expect(records).toHaveLength(1);
  expect(records[0].phase).toBe(failAt === 2 ? "reconciliation-required" : "provider-confirmed");
});

it("retains provider receipt and leaves newer grading unchanged when completion loses its generation", async () => {
  const f = await fixture(); const entered = gate(); const finish = gate();
  const fetch = vi.fn(async () => { entered.release(); await finish.promise; return Response.json({ status: "release-rolled-back", rollbackId: "receipt-a" }); });
  const first = f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch }));
  await entered.promise; await f.grade(new Date("2026-06-22T10:45:00Z")); finish.release();
  const result = await first; expect(result.status).toBe(409);
  expect((await result.json()).providerOperation).toMatchObject({ phase: "provider-confirmed", providerReceiptId: "receipt-a" });
  expect((await operations.readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId }))?.updateStatus).toBe("pending-release");
  expect((await f.invoke(createTeachingGradebookReleasePostHandler({ env: f.env, now, fetch }))).status).toBe(409);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps completed dispatch evidence across backup restore and refuses to resend the restored generation", async () => {
  const f = await fixture(); const fetch = vi.fn(async () => Response.json({ status: "release-rolled-back", rollbackId: "receipt-a" }));
  const handler = createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch });
  expect((await f.invoke(handler)).status).toBe(200);
  const files = await readdir(join(f.dataDir, "backups"));
  const file = files.find((name) => name.includes("20260622-110000")); expect(file).toBeTruthy();
  await operations.restoreTeachingOperationDatabaseBackup({ dataDir: f.dataDir, backupId: file!.replace(/\.json$/, ""), actorId: "teacher-a", audit, now });
  expect((await f.invoke(handler)).status).toBe(409); expect(fetch).toHaveBeenCalledTimes(1);
});

it("exposes preserved evidence through owned audit readback after restoring away its gradebook", async () => {
  const f = await fixture(); const fetch = vi.fn(async () => { throw new Error("Synthetic uncertain send"); });
  const response = await f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch }));
  const operation = (await response.json()).providerOperation;
  const databasePath = join(f.dataDir, "teaching-operations.json");
  const database = JSON.parse(await readFile(databasePath, "utf8")); database.domainProjections = []; database.records = []; database.auditEvents = [];
  await writeFile(databasePath, JSON.stringify(database)); // Synthetic restored old state only.
  const auditHandler = createTeachingOperationAuditGetHandler({ env: f.env, now });
  const readback = await auditHandler(f.request("GET")); expect(readback.status).toBe(200);
  expect((await readback.json()).providerOperations).toContainEqual(expect.objectContaining({ operationId: operation.operationId }));
  await storeUaisTeacherAiOwnershipRecord({ baseDir: f.env.UAIS_TEACHER_AI_OWNERSHIP_DIR, ownership: { teacherId: "teacher-a", courseIds: ["other-course"] } });
  const denied = await auditHandler(f.request("GET")); expect((await denied.json()).providerOperations).toEqual([]);
});

it("allows a later explicit release generation while retaining completed earlier intent", async () => {
  const f = await fixture(); const fetch = vi.fn(async (_url, init) => JSON.parse(String(init?.body)).action === "rollback-gradebook-release"
    ? Response.json({ status: "release-rolled-back", rollbackId: "rollback-a" }) : Response.json({ status: "released", releaseId: "release-b" }));
  const rollback = createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch });
  expect((await f.invoke(rollback)).status).toBe(200);
  expect((await f.invoke(createTeachingGradebookReleasePostHandler({ env: f.env, now, fetch }))).status).toBe(200);
  expect((await f.invoke(rollback)).status).toBe(200); expect(fetch).toHaveBeenCalledTimes(3);
  const intents = await readGradebookProviderOperations({ env: f.env });
  expect(intents).toHaveLength(3); expect(intents[0].releaseGenerationId).not.toBe(intents[2].releaseGenerationId);
});

it("records local-only completion without claiming provider confirmation", async () => {
  const f = await fixture(); const env = { ...f.env, UAIS_GRADEBOOK_RELEASE_PROVIDER: "" }; const fetch = vi.fn();
  const response = await f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env, now, fetch }));
  expect(response.status).toBe(200); expect(fetch).not.toHaveBeenCalled();
  expect((await response.json()).providerOperation).toMatchObject({ dispatchMode: "local", phase: "succeeded" });
  expect((await readGradebookProviderOperations({ env }))[0].providerReceiptId).toBeUndefined();
});

it("fails closed before provider call for external readback even with an injected atomic journal", async () => {
  const f = await fixture(); const database = await operations.readTeachingOperationDatabase({ dataDir: f.dataDir });
  vi.spyOn(operations, "createUaisTeachingOperationExternalAuditReadAdapter").mockReturnValue(async () => ({ teacherId: "teacher-a", records: database.records, auditEvents: database.auditEvents, domainProjections: database.domainProjections }));
  vi.spyOn(operations, "createUaisTeachingOperationExternalAppendAdapter").mockReturnValue(vi.fn());
  const fetch = vi.fn(); const response = await f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch, providerOperationsRepository: repository() }));
  expect(response.status).toBe(503); expect((await response.json()).reasonCode).toBe("gradebook-provider-claim-storage-unavailable"); expect(fetch).not.toHaveBeenCalled();
});

it("uses strict CAS for concurrent first claims and preserves unrelated claims", async () => {
  const f = await fixture(); const claims = repository();
  const update = (await operations.readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId }))!;
  const input = { env: f.env, repository: claims, action: "rollback" as const, dispatchMode: "provider" as const, gradebookUpdate: update, actorId: "teacher-a", traceId: audit.traceId, audit, now };
  const results = await Promise.allSettled([claimGradebookProviderOperation(input), claimGradebookProviderOperation(input)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect((await readGradebookProviderOperations({ env: f.env, repository: claims }))[0].generation).toBe(gradebookProviderGeneration(update));
});

it.each(["release", "rollback"] as const)("GET/HEAD %s remain read-only, including unauthorized requests", async (action) => {
  const f = await fixture();
  if (action === "release") await f.grade(new Date("2026-06-22T10:45:00Z"));
  const before = await operations.readTeachingOperationDatabase({ dataDir: f.dataDir });
  const fetch = vi.fn();
  const handler = action === "release" ? createTeachingGradebookReleasePostHandler({ env: f.env, now, fetch }) : createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch });
  for (const method of ["GET", "HEAD"]) {
    const response = await f.invoke(handler, method); expect(response.status).toBe(200);
    expect((await response.json()).providerOperations).toEqual([]);
    expect((await handler(new Request("https://example.test/rollback", { method }), { params: Promise.resolve({ objectId }) })).status).toBe(401);
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(await readGradebookProviderOperations({ env: f.env })).toEqual([]);
  expect(await operations.readTeachingOperationDatabase({ dataDir: f.dataDir })).toEqual(before);
});

it.each(["headers", "body"])("bounds an ambiguous stalled %s response and never dispatches again", async (stage) => {
  const f = await fixture(); const entered = gate();
  const fetch = vi.fn(async () => {
    entered.release();
    if (stage === "headers") return await new Promise<Response>(() => undefined);
    return { ok: true, json: () => new Promise(() => undefined) } as Response;
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const handler = createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch });
  const response = f.invoke(handler); await entered.promise;
  await vi.advanceTimersByTimeAsync(10_001); vi.useRealTimers();
  expect((await response).status).toBe(502);
  expect((await f.invoke(handler)).status).toBe(409); expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not send internal release generation metadata to the provider", async () => {
  const f = await fixture();
  const fetch = vi.fn(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).gradebookUpdate).not.toHaveProperty("releaseGenerationId");
    return Response.json({ status: "release-rolled-back", rollbackId: "receipt-a" });
  });
  expect((await f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch }))).status).toBe(200);
});

it("selects and releases the latest grading save while preserving the historical released generation", async () => {
  const f = await fixture(); const before = await operations.readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId });
  await f.grade(new Date("2026-06-22T10:45:00Z"));
  const current = await operations.readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId });
  expect(current?.updateStatus).toBe("pending-release"); expect(current?.operationRecordId).not.toBe(before?.operationRecordId);
  const fetch = vi.fn(async (_url, init) => JSON.parse(String(init?.body)).action === "rollback-gradebook-release"
    ? Response.json({ status: "release-rolled-back", rollbackId: "rollback-b" }) : Response.json({ status: "released", releaseId: "release-b" }));
  expect((await f.invoke(createTeachingGradebookReleasePostHandler({ env: f.env, now, fetch }))).status).toBe(200);
  expect((await f.invoke(createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch }))).status).toBe(200);
  const all = (await operations.readTeachingOperationDatabase({ dataDir: f.dataDir })).domainProjections.filter((item) => item.objectId === objectId);
  expect(all[0]).toEqual(before); expect(all.at(-1)).toMatchObject({ operationRecordId: current?.operationRecordId, updateStatus: "release-rolled-back" });
});

it("keeps both unrelated claims when concurrent snapshot CAS retries", async () => {
  const f = await fixture(); const claims = repository(); const update = (await operations.readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId }))!;
  const input = { env: f.env, repository: claims, action: "rollback" as const, dispatchMode: "provider" as const, gradebookUpdate: update, actorId: "teacher-a", traceId: audit.traceId, audit, now };
  await Promise.all([claimGradebookProviderOperation(input), claimGradebookProviderOperation({ ...input, gradebookUpdate: { ...update, objectId: "gradebook-update-other-course", courseId: "other-course" } })]);
  expect(await readGradebookProviderOperations({ env: f.env, repository: claims })).toHaveLength(2);
});

it("uses managed CAS without creating filesystem locks or data directories", async () => {
  const f = await fixture(); const managed = repository();
  await managed.write({ database: await operations.readTeachingOperationDatabase({ dataDir: f.dataDir }) });
  // A regular file makes any attempted lock-directory creation fail ENOTDIR.
  const notDirectory = join(f.dataDir, "not-a-directory"); await writeFile(notDirectory, "synthetic");
  const input = { dataDir: join(notDirectory, "managed"), repository: managed, env: {}, objectId, actorId: "teacher-a", audit, now };
  await operations.rollbackTeachingGradebookRelease(input);
  await operations.releaseTeachingGradebookUpdate(input);
  await operations.executeTeachingOperationAction({ dataDir: input.dataDir, repository: managed, env: {}, operationId: "grading", actionSlot: "primary", courseId: "course-b", actorId: "teacher-a", now });
  expect((await managed.read()).database.domainProjections).toContainEqual(expect.objectContaining({ courseId: "course-b" }));
  const update = (await operations.readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId }))!;
  await claimGradebookProviderOperation({ env: { UAIS_TEACHING_OPERATIONS_DATA_DIR: input.dataDir }, repository: repository(), action: "rollback", dispatchMode: "provider", gradebookUpdate: update, actorId: "teacher-a", traceId: audit.traceId, audit, now });
});

it.each(["provider-confirmed", "succeeded", "completion-pending"] as const)("refuses malformed persisted %s receipt evidence", async (phase) => {
  const f = await fixture(); const claims = repository(); const update = (await operations.readTeachingGradebookUpdate({ dataDir: f.dataDir, objectId }))!;
  await claimGradebookProviderOperation({ env: f.env, repository: claims, action: "rollback", dispatchMode: "provider", gradebookUpdate: update, actorId: "teacher-a", traceId: audit.traceId, audit, now });
  const snapshot = await claims.read(); snapshot.database.providerOperations![0].phase = phase;
  await claims.write({ database: snapshot.database, expectedRevision: snapshot.revision });
  await expect(readGradebookProviderOperations({ env: f.env, repository: claims })).rejects.toMatchObject({ status: 503 });
});

it.each(["generation", "payloadHash"] as const)("refuses malformed completed %s evidence before rearming a restored generation", async (field) => {
  const f = await fixture(); const claims = repository();
  const fetch = vi.fn(async () => Response.json({ status: "release-rolled-back", rollbackId: "receipt-a" }));
  const handler = createTeachingGradebookReleaseRollbackPostHandler({ env: f.env, now, fetch, providerOperationsRepository: claims });
  expect((await f.invoke(handler)).status).toBe(200);
  const backup = (await readdir(join(f.dataDir, "backups"))).find((name) => name.includes("20260622-110000"))!;
  await operations.restoreTeachingOperationDatabaseBackup({ dataDir: f.dataDir, backupId: backup.replace(/\.json$/, ""), actorId: "teacher-a", audit, now });
  const snapshot = await claims.read(); snapshot.database.providerOperations![0][field] = "damaged";
  await claims.write({ database: snapshot.database, expectedRevision: snapshot.revision });
  expect((await f.invoke(handler)).status).toBe(503);
  expect(fetch).toHaveBeenCalledTimes(1);
});
