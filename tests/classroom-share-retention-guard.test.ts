import { describe, expect, it } from "vitest";
import { createUaisLearningChatroomSharePostgresRepository } from "@/lib/server/learning-chatroom-share-postgres-store";
import { createEmptyLearningChatroomShareDatabase, type LearningChatroomShareRecord } from "@/lib/server/learning-chatroom-share-store";
const env = { UAIS_CORE_DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:1/never" };
const share = (courseId: string, suffix = "1"): LearningChatroomShareRecord => ({ courseId, shareId: `share-${courseId}-${suffix}`, createdBy: "student-1", createdAt: "2026-10-26T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z", storagePolicy: "postgres-learning-chatroom-shares", storageWritePolicy: "postgres-transactional-snapshot-replace", responsibleSession: "S12", redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" } });
function client(purged = false) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = Object.assign(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim(); calls.push({ text, values });
    if (text.includes("FROM uais_course_record_retention")) return purged ? [{ closed_at: "2026-01-01", purged_at: "2026-07-01" }] : [{ closed_at: "2026-01-01", purged_at: null }];
    if (text.includes("INSERT INTO")) return [{ snapshot_key: "default" }];
    return [];
  }, { begin: async (run: (sql: never) => Promise<void>) => { await run(sql as never); }, end: async () => {} });
  return { calls, factory: () => ({ sql }) };
}
describe("share snapshot retention ordering", () => {
  it("blocks purged-course shares before locking or replacing the global snapshot", async () => {
    const fixture = client(true), repository = createUaisLearningChatroomSharePostgresRepository({ env, createDatabase: fixture.factory });
    await expect(repository.write({ database: { ...createEmptyLearningChatroomShareDatabase(), shares: [share("course-a")] } })).rejects.toMatchObject({ status: 423, message: "course-records-purged" });
    expect(fixture.calls.some(call => call.text.includes("FOR UPDATE") || call.text.includes("INSERT INTO"))).toBe(false);
  });
  it("locks distinct course keys in a stable order before the global row while allowing closed courses", async () => {
    const fixture = client(), repository = createUaisLearningChatroomSharePostgresRepository({ env, createDatabase: fixture.factory });
    await repository.write({ database: { ...createEmptyLearningChatroomShareDatabase(), shares: [share("course-z"), share("course-a"), share("course-z", "2")] } });
    const locks = fixture.calls.filter(call => call.text.includes("pg_advisory_xact_lock_shared"));
    expect(locks.map(call => call.values[0])).toEqual(["uais-classroom-records:course-a", "uais-classroom-records:course-z"]);
    const rowLock = fixture.calls.findIndex(call => call.text.includes("FOR UPDATE"));
    expect(fixture.calls.indexOf(locks[1])).toBeLessThan(rowLock);
    expect(fixture.calls.filter(call => call.text.includes("INSERT INTO"))).toHaveLength(1);
  });
});
