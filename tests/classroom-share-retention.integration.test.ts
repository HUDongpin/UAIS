// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createUaisLearningChatroomSharePostgresRepository } from "@/lib/server/learning-chatroom-share-postgres-store";
import { createEmptyLearningChatroomShareDatabase, type LearningChatroomShareRecord } from "@/lib/server/learning-chatroom-share-store";
const url = process.env.UAIS_CLASSROOM_ACCOUNTS_TEST_URL;
const approved = url && new URL(url).hostname === "127.0.0.1" && new URL(url).pathname === "/uais_classroom_accounts";
describe.skipIf(!approved)("share versus purge on isolated Postgres", () => {
  let sql: ReturnType<typeof postgres>;
  const courseId = `share-purge-race-${randomUUID()}`;
  beforeAll(async () => { sql = postgres(url!, { max: 3 }); expect(await sql`SELECT environment FROM uais_environment_guard WHERE environment='isolated-uais-db-test' AND enabled`).toHaveLength(1); });
  afterAll(async () => { if (sql) { await sql`DELETE FROM uais_course_record_retention WHERE course_external_id=${courseId}`; await sql.end(); } });
  it("a mint waiting behind an in-progress purge observes its committed tombstone and cannot resurrect a share", async () => {
    const repository = createUaisLearningChatroomSharePostgresRepository({ env: { UAIS_CORE_DATABASE_URL: url! }, createDatabase: () => ({ pooled: true, sql }) });
    const before = await repository.read();
    const record: LearningChatroomShareRecord = { shareId: `share-${randomUUID()}`, courseId, createdBy: "test-student", createdAt: "2026-10-26T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z", storagePolicy: "postgres-learning-chatroom-shares", storageWritePolicy: "postgres-transactional-snapshot-replace", responsibleSession: "S12", redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" } };
    let locked!: () => void, unlock!: () => void;
    const lockReady = new Promise<void>(resolve => { locked = resolve; });
    const releasePurge = new Promise<void>(resolve => { unlock = resolve; });
    const purge = sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'uais-classroom-records:' + courseId},0))`;
      await tx`INSERT INTO uais_course_record_retention(course_external_id,closed_at,purge_after,purged_at) VALUES (${courseId},'2026-01-01T00:00:00Z','2026-06-30T00:00:00Z','2026-07-01T00:00:00Z')`;
      locked(); await releasePurge;
    });
    await lockReady;
    let settled = false;
    const write = repository.write({ database: { ...createEmptyLearningChatroomShareDatabase(), shares: [...before.database.shares, record] }, expectedRevision: before.revision }).then(() => ({ ok: true as const }), error => ({ ok: false as const, error })).finally(() => { settled = true; });
    try { await new Promise(resolve => setTimeout(resolve, 30)); expect(settled).toBe(false); }
    finally { unlock(); }
    await purge;
    const result = await write;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ status: 423, message: "course-records-purged" });
    const after = await repository.read();
    expect(after).toEqual(before);
  });
});
