import { expect, it, vi } from "vitest";
import { dispatchLearningOutboxBatch } from "@/lib/learning-loop/outbox-worker";
import { createUaisLearningLoopPostgresStore, type LearningLoopPostgresClientFactory } from "@/lib/learning-loop/postgres-store";
import { createLearningRecordAnalyticsGetHandler } from "@/app/api/learning-records/analytics/handler";
import { createLearnerProfileFromXapiStatements } from "@/lib/learning-records/learner-profile";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";
import { resolveLearningRecordLearnerActorIds, type LearningRecordIdentityClientFactory } from "@/lib/learning-records/learner-actor-identities";
import type { XapiStatement } from "@/lib/learning-records/lrs-client";

const env = {
  UAIS_CORE_DATABASE_URL: "postgres://synthetic@fixture.invalid/isolated-unused",
  UAIS_APP_SESSION_SIGNING_SECRET: "synthetic-event-review-signing-secret",
  UAIS_LRS_ENDPOINT: "https://fixture.invalid/xapi/",
  UAIS_LRS_USERNAME: "synthetic", UAIS_LRS_PASSWORD: "synthetic",
};
const actorUuid = "22222222-2222-4222-8222-222222222222";
const account = "fixture-student";
const row = {
  outbox_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  learning_event_id: "99999999-9999-4999-8999-999999999999",
  statement_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  attempt_count: 0, actor_id: actorUuid, actor_role: "student",
  event_type: "lesson.viewed", object_id: "course-fixture/lesson-fixture",
  course_external_id: "course-fixture", class_external_id: "class-fixture",
  lesson_key: null,
  context: { lessonKey: "lesson-fixture", competencyIds: ["fixture-competency"], result: { completion: true, success: true } },
  occurred_at: "2026-09-30T12:00:00.000Z",
};
function identityDatabase(rows: Array<{ id: string; account: string }>): LearningRecordIdentityClientFactory {
  const sql = Object.assign(async () => rows, { end: async () => undefined });
  return () => ({ sql });
}
async function emittedStatement(overrides: Partial<typeof row> = {}) {
  const sql = async (parts: TemplateStringsArray) => parts.join("?").includes("FOR UPDATE SKIP LOCKED") ? [{ ...row, ...overrides }] : [];
  sql.begin = async (run: (tx: typeof sql) => Promise<void>) => run(sql);
  sql.end = async () => undefined;
  const store = createUaisLearningLoopPostgresStore({ env, createDatabase: (() => ({ sql })) as unknown as LearningLoopPostgresClientFactory });
  let statement!: XapiStatement;
  await dispatchLearningOutboxBatch({ env, workerId: "fixture-worker", store,
    fetch: async (_url, init) => { statement = JSON.parse(String(init?.body)); return Response.json([statement.id]); },
  });
  return statement;
}

it("reads durable events through the authorized learner analytics identity", async () => {
  const stored = await emittedStatement();
  const cookie = createUaisAppSessionCookie({ account, role: "student", displayName: "Fixture", department: "Fixture" }, { env });
  const handler = createLearningRecordAnalyticsGetHandler({ env, resolveLearnerActorIds: (input) => resolveLearningRecordLearnerActorIds({ ...input, createDatabase: identityDatabase([{ id: actorUuid, account }]) }), fetch: async (request) => {
    const agent = JSON.parse(new URL(String(request)).searchParams.get("agent")!);
    return Response.json({ statements: agent.account.name === stored.actor.account?.name ? [stored] : [], more: "" });
  } });
  const response = await handler(new Request("https://fixture.invalid/api/learning-records/analytics?scope=learner-profile&courseId=course-fixture", { headers: { cookie } }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.summary.eventCount).toBe(1);
});

it("preserves generic browser lesson/completion evidence in the durable mirror", async () => {
  const stored = await emittedStatement();
  const profile = createLearnerProfileFromXapiStatements({ statements: [stored], courseId: "course-fixture" });
  expect(profile.progress.activeLessonCount).toBe(1);
  expect(profile.completedLessonIds).toEqual(["lesson-fixture"]);
  expect(stored.context?.contextActivities?.category).toEqual([{ id: "https://uais.top/xapi/activities/competencies/fixture-competency" }]);
});

it("keeps raw answers and unapproved result fields out of the mirror", async () => {
  const stored = await emittedStatement({ context: {
    lessonKey: "lesson-fixture", competencyIds: ["fixture-competency"],
    result: { completion: true, success: false, duration: "PT30S", response: "private answer", score: { scaled: 1 }, extensions: { private: "body" } },
    locale: "en-US", privateNotes: "private notes",
  } as typeof row.context });
  expect(stored.result).toEqual({ completion: true, success: false, duration: "PT30S", extensions: {} });
  expect(stored.context?.language).toBe("en-US");
  expect(stored.object.definition?.type).toMatch(/\/lesson$/);
  expect(JSON.stringify(stored)).not.toMatch(/private|scaled/);
  expect(stored.actor.account?.name).toBe(`learner:${actorUuid}`);
});

it("resolves durable and legacy identities without selecting private account fields", async () => {
  let query = "";
  const sql = Object.assign(async (parts: TemplateStringsArray) => {
    query = parts.join("?");
    return [{ id: actorUuid, account }];
  }, { end: async () => undefined });
  await expect(resolveLearningRecordLearnerActorIds({ account, env, createDatabase: () => ({ sql }) })).resolves.toEqual([actorUuid, account]);
  expect(query).toContain("SELECT id::text AS id, account");
  expect(query).not.toMatch(/password|status|display_name/);
});

it("retains legacy non-core queries without opening a database", async () => {
  const createDatabase = vi.fn(identityDatabase([]));
  await expect(resolveLearningRecordLearnerActorIds({ account, env: {}, createDatabase })).resolves.toEqual([account]);
  expect(createDatabase).not.toHaveBeenCalled();
});

it("does not query another learner when a legacy account is their durable UUID", async () => {
  const ownId = "33333333-3333-4333-8333-333333333333";
  await expect(resolveLearningRecordLearnerActorIds({
    account: actorUuid, env, createDatabase: identityDatabase([
      { id: ownId, account: actorUuid }, { id: actorUuid, account: "another-student" },
    ]),
  })).resolves.toEqual([ownId]);
});

it("denies cross-learner requests before resolving any database identity", async () => {
  const resolveLearnerActorIds = vi.fn(async () => [actorUuid]);
  const getStatements = vi.fn();
  const handler = createLearningRecordAnalyticsGetHandler({ env, resolveLearnerActorIds, getStatements });
  const cookie = createUaisAppSessionCookie({ account, role: "student", displayName: "Fixture", department: "Fixture" }, { env });
  const response = await handler(new Request("https://fixture.invalid/api/learning-records/analytics?scope=learner-profile&actorId=another-student", { headers: { cookie } }));
  expect(response.status).toBe(403);
  expect(resolveLearnerActorIds).not.toHaveBeenCalled();
  expect(getStatements).not.toHaveBeenCalled();
});

it("fails closed with a redacted response when identity lookup fails", async () => {
  const getStatements = vi.fn();
  const handler = createLearningRecordAnalyticsGetHandler({ env,
    resolveLearnerActorIds: async () => { throw new Error("private database failure"); }, getStatements,
  });
  const cookie = createUaisAppSessionCookie({ account, role: "student", displayName: "Fixture", department: "Fixture" }, { env });
  const response = await handler(new Request("https://fixture.invalid/api/learning-records/analytics?scope=learner-profile", { headers: { cookie } }));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private database failure");
  expect(getStatements).not.toHaveBeenCalled();
});

it("merges legacy and UUID evidence once per statement, newest first within one page", async () => {
  const stored = await emittedStatement();
  const legacy = { ...stored, id: "legacy-event", actor: { ...stored.actor, account: { ...stored.actor.account!, name: `learner:${account}` } }, timestamp: "2026-09-29T12:00:00.000Z" };
  const getStatements = vi.fn(async ({ query }: { query: { agent?: { id: string } } }) => ({
    statements: query.agent?.id === actorUuid ? [stored] : [legacy, stored], more: "",
    redaction: { endpoint: "fingerprinted" as const, credentials: "omitted" as const, rawStatements: "summarized" as const },
  }));
  const handler = createLearningRecordAnalyticsGetHandler({ env, resolveLearnerActorIds: async () => [actorUuid, account], getStatements });
  const cookie = createUaisAppSessionCookie({ account, role: "student", displayName: "Fixture", department: "Fixture" }, { env });
  const response = await handler(new Request("https://fixture.invalid/api/learning-records/analytics?scope=learner-profile&courseId=course-fixture", { headers: { cookie } }));
  expect(response.status).toBe(200);
  expect((await response.json()).summary).toMatchObject({ eventCount: 2, latestTimestamp: stored.timestamp });
  expect(getStatements.mock.calls.map(([value]) => value.query.agent?.id)).toEqual([actorUuid, account]);
});

it("caps the combined identities to the newest 100 learner events", async () => {
  const stored = await emittedStatement();
  const events = Array.from({ length: 120 }, (_, index) => ({
    ...stored, id: `fixture-event-${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 30, 12, index)).toISOString(),
    result: { completion: index < 20 },
  }));
  const handler = createLearningRecordAnalyticsGetHandler({ env,
    resolveLearnerActorIds: async () => [actorUuid, account],
    getStatements: async ({ query }) => ({
      statements: query.agent?.id === actorUuid ? events.slice(60) : events.slice(0, 60),
      more: "", redaction: { endpoint: "fingerprinted", credentials: "omitted", rawStatements: "summarized" },
    }),
  });
  const cookie = createUaisAppSessionCookie({ account, role: "student", displayName: "Fixture", department: "Fixture" }, { env });
  const response = await handler(new Request("https://fixture.invalid/api/learning-records/analytics?scope=learner-timeline", { headers: { cookie } }));
  expect((await response.json()).summary).toMatchObject({ eventCount: 100, completedCount: 0, latestTimestamp: events.at(-1)?.timestamp });
});

it("rejects ambiguous account mappings and closes the identity client", async () => {
  const end = vi.fn(async () => undefined);
  const sql = Object.assign(async () => [
    { id: actorUuid, account }, { id: "33333333-3333-4333-8333-333333333333", account: account.toUpperCase() },
  ], { end });
  await expect(resolveLearningRecordLearnerActorIds({ account, env, createDatabase: () => ({ sql }) })).rejects.toThrow("ambiguous");
  expect(end).toHaveBeenCalledOnce();
});

it("compares mixed-offset history by instant before capping and omits invalid dates", async () => {
  const stored = await emittedStatement();
  const recent = { ...stored, id: "recent-offset", timestamp: "2026-09-30T01:00:00-12:00", result: { completion: false } };
  const older = { ...stored, id: "older-offset", timestamp: "2026-09-30T23:59:59+14:00", result: { completion: true } };
  const invalid = { ...stored, id: "invalid-date", timestamp: "not-an-instant", result: { completion: true } };
  const middle = Array.from({ length: 99 }, (_, index) => ({ ...stored, id: `middle-${index}`, result: { completion: false } }));
  const handler = createLearningRecordAnalyticsGetHandler({ env,
    resolveLearnerActorIds: async () => [actorUuid, account],
    getStatements: async ({ query }) => ({
      statements: query.agent?.id === actorUuid ? middle : [recent, older, invalid], more: "",
      redaction: { endpoint: "fingerprinted", credentials: "omitted", rawStatements: "summarized" },
    }),
  });
  const cookie = createUaisAppSessionCookie({ account, role: "student", displayName: "Fixture", department: "Fixture" }, { env });
  const response = await handler(new Request("https://fixture.invalid/api/learning-records/analytics?scope=learner-timeline", { headers: { cookie } }));
  expect((await response.json()).summary).toMatchObject({ eventCount: 100, completedCount: 0, latestTimestamp: "2026-09-30T13:00:00.000Z" });
});
