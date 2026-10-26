// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { createClassroomRosterStore } from "@/lib/server/classroom-roster-store";
import { createUaisAppAccountAuthenticator } from "@/lib/server/uais-app-account-store";
import { hashUaisAccountPassword, verifyUaisAccountPassword } from "@/lib/server/uais-app-password-hash";

// Opt-in loopback-only disposable database, never reads runtime credentials.
const url = process.env.UAIS_CLASSROOM_ACCOUNTS_TEST_URL;
const eligible = url && new URL(url).hostname === "127.0.0.1" && new URL(url).pathname === "/uais_classroom_accounts";
const suite = eligible ? describe : describe.skip;
suite("classroom account transaction integration", () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} });
  const store = createClassroomRosterStore({ env: {}, sql });
  const scope = { actorId: "test-roster-teacher", courseId: "test-roster-course", classId: "test-roster-class" };
  beforeAll(async () => {
    await sql.unsafe(await readFile("migrations/0014_classroom_accounts.sql", "utf8"));
    await sql.unsafe(await readFile("migrations/0015_classroom_chat_retention.sql", "utf8"));
    await sql`DELETE FROM uais_course_record_retention WHERE course_external_id=${scope.courseId}`;
    await sql`DELETE FROM uais_users WHERE account LIKE 'test-roster-%'`;
    await sql`INSERT INTO uais_teaching_course_management_snapshots(snapshot_key, database, revision) VALUES (${scope.courseId}, ${sql.json({ courses: [{ courseId: scope.courseId, ownerTeacherId: scope.actorId }], classes: [{ courseId: scope.courseId, classId: scope.classId, ownerTeacherId: scope.actorId }] })}, 'test') ON CONFLICT(snapshot_key) DO UPDATE SET database=EXCLUDED.database`;
  });
  afterAll(async () => { await sql.end(); });
  it("refuses nonowners before provisioning accounts", async () => {
    await expect(store.import({ ...scope, actorId: "test-roster-stranger", csv: "account,displayName\ntest-roster-denied,No" })).rejects.toMatchObject({ status: 403 });
    expect(await sql`SELECT id FROM uais_users WHERE account='test-roster-denied'`).toHaveLength(0);
  });
  it("serializes duplicate concurrent imports and never changes existing role, name or password", async () => {
    const csv = "account,displayName,email\ntest-roster-student,Original,test-roster@example.edu";
    const results = await Promise.all([store.import({ ...scope, csv }), store.import({ ...scope, csv })]);
    expect(results.map(item => item.createdCount).sort()).toEqual([0, 1]);
    const credential = results.flatMap(item => item.credentials)[0];
    const before = (await sql`SELECT * FROM uais_users WHERE account='test-roster-student'`)[0];
    await store.import({ ...scope, csv: "account,displayName\ntest-roster-student,Changed" });
    const after = (await sql`SELECT * FROM uais_users WHERE account='test-roster-student'`)[0];
    expect(after).toEqual(before);
    expect(await verifyUaisAccountPassword({ plaintext: credential.initialPassword, encoded: after.password_hash })).toBe(true);
  });
  it("blocks account collisions with a teacher and rejects the entire import", async () => {
    await sql`INSERT INTO uais_users(account,display_name,role,status,password_hash) VALUES ('test-roster-existing-teacher','Teacher','teacher','active',${await hashUaisAccountPassword("test-only-existing-password")})`;
    await expect(store.import({ ...scope, csv: "account,displayName\ntest-roster-new,B\ntest-roster-existing-teacher,A" })).rejects.toMatchObject({ status: 409 });
    expect(await sql`SELECT id FROM uais_users WHERE account='test-roster-new'`).toHaveLength(0);
  });
  it("reissue invalidates setup version, then setup activates once and prevents teacher reset", async () => {
    await store.import({ ...scope, csv: "account,displayName\ntest-roster-activate,Student" });
    const initial = await store.reissue({ ...scope, account: "test-roster-activate" });
    await expect(store.setFirstPassword({ account: initial.account, credentialVersion: 1, password: "my-new-safe-password" })).rejects.toMatchObject({ status: 401 });
    await expect(store.setFirstPassword({ account: initial.account, credentialVersion: 2, password: initial.initialPassword })).rejects.toMatchObject({ code: "password-must-differ-from-initial" });
    const authenticate = createUaisAppAccountAuthenticator({ env: { UAIS_CORE_DATABASE_URL: url! }, createDatabase: () => ({ pooled: true, sql }) })!;
    expect(await authenticate({ account: initial.account, password: initial.initialPassword })).toMatchObject({ passwordSetup: { credentialVersion: 2 } });
    await store.setFirstPassword({ account: initial.account, credentialVersion: 2, password: "my-new-safe-password" });
    expect(await authenticate({ account: initial.account, password: initial.initialPassword })).toBeNull();
    expect(await authenticate({ account: initial.account, password: "my-new-safe-password" })).not.toHaveProperty("passwordSetup");
    await expect(store.setFirstPassword({ account: initial.account, credentialVersion: 2, password: "another-safe-password" })).rejects.toMatchObject({ status: 401 });
    await expect(store.reissue({ ...scope, account: initial.account })).rejects.toMatchObject({ status: 403 });
  });
  it("another teacher cannot reissue a pending credential", async () => {
    await expect(store.reissue({ ...scope, actorId: "stranger", account: "test-roster-student" })).rejects.toMatchObject({ status: 403 });
  });
  it("retains account status but refuses provisioning and credential reissue after the course ends", async () => {
    await sql`INSERT INTO uais_course_record_retention(course_external_id,closed_at,purge_after) VALUES (${scope.courseId},now(),now()+interval '180 days')`;
    expect((await store.list(scope)).length).toBeGreaterThan(0);
    const result = await store.import({ ...scope, csv: "account,displayName\ntest-roster-after-close,No" })
      .then(() => ({ status: "unexpected-success" }), error => ({ status: error.status, reasonCode: error.reasonCode }));
    expect(result).toEqual({ status: 423, reasonCode: "course-records-closed" });
    await expect(store.reissue({ ...scope, account: "test-roster-student" }))
      .rejects.toMatchObject({ status: 423, reasonCode: "course-records-closed" });
    expect(await sql`SELECT id FROM uais_users WHERE account='test-roster-after-close'`).toHaveLength(0);
    await sql`DELETE FROM uais_course_record_retention WHERE course_external_id=${scope.courseId}`;
  });
});
