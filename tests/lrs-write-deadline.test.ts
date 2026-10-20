import { afterEach, expect, it, vi } from "vitest";
import { postXapiStatement } from "@/lib/learning-records/lrs-client";
import { createLearningEventStatement } from "@/lib/learning-records/xapi-events";
import { dispatchLearningOutboxBatch, type ClaimedLearningOutboxItem } from "@/lib/learning-loop/outbox-worker";

const config = { endpoint: "https://fixture.invalid/xapi/", username: "synthetic", password: "synthetic", xapiVersion: "1.0.3" };
const statement = createLearningEventStatement({
  actor: { id: "fixture-uuid", role: "learner" },
  event: { type: "lesson.viewed", object: { id: "fixture-lesson", name: "Fixture" }, context: { courseId: "fixture-course" } },
  statementId: "11111111-1111-4111-8111-111111111111",
  timestamp: "2026-09-30T12:00:00.000Z",
});
afterEach(() => { vi.useRealTimers(); });

it.each(["fetch", "body"])("bounds a hanging %s and aborts its transport", async (phase) => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  const never = new Promise<Response>(() => undefined);
  let caught: unknown;
  const request = postXapiStatement({ config, statement, fetch: async (_url, init) => {
    signal = init?.signal;
    if (phase === "fetch") return never;
    return { ok: true, status: 200, text: () => new Promise<string>(() => undefined) } as Response;
  } }).catch((error) => { caught = error; });
  await vi.advanceTimersByTimeAsync(10_001);
  expect(caught).toMatchObject({ name: "AbortError", message: "LRS statement write timed out." });
  expect(signal?.aborted).toBe(true);
  await request;
});

it("clears the deadline after an ordinary write without aborting its signal", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  const result = await postXapiStatement({ config, statement, fetch: async (_url, init) => {
    signal = init?.signal;
    expect(JSON.parse(String(init?.body)).id).toBe(statement.id);
    return Response.json([statement.id]);
  } });
  expect(result.status).toBe("passed");
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(10_001);
  expect(signal?.aborted).toBe(false);
});

it("records a timed-out attempt and continues the batch with the next statement", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
  const first: ClaimedLearningOutboxItem = {
    outboxId: "first", learningEventId: "first-event", statementId: statement.id,
    attemptCount: 1, actorId: "fixture-uuid", actorRole: "student",
    eventType: "lesson.viewed", objectId: "fixture-lesson", objectName: "Fixture",
    courseExternalId: "fixture-course", context: {}, occurredAt: statement.timestamp,
  };
  const markFailed = vi.fn(async () => undefined);
  const markSent = vi.fn(async () => undefined);
  const sentIds: string[] = [];
  let result: Awaited<ReturnType<typeof dispatchLearningOutboxBatch>> | undefined;
  const request = dispatchLearningOutboxBatch({
    env: { UAIS_LRS_ENDPOINT: config.endpoint, UAIS_LRS_USERNAME: config.username, UAIS_LRS_PASSWORD: config.password },
    workerId: "fixture-worker",
    store: { claimBatch: async () => [first, { ...first, outboxId: "second", statementId: "22222222-2222-4222-8222-222222222222" }], markFailed, markSent },
    fetch: async (_url, init) => {
      sentIds.push(JSON.parse(String(init?.body)).id);
      return sentIds.length === 1 ? new Promise<Response>(() => undefined) : Response.json([sentIds.at(-1)]);
    },
  }).then((value) => { result = value; });
  await vi.advanceTimersByTimeAsync(10_001);
  expect(result).toMatchObject({ status: "processed", claimed: 2, failed: 1, sent: 1 });
  expect(markFailed).toHaveBeenCalledWith({ outboxId: "first", workerId: "fixture-worker", status: "failed", attemptCount: 2, errorCategory: "lrs-timeout", nextAttemptAt: "2026-09-30T12:05:00.000Z" });
  expect(markSent).toHaveBeenCalledWith(expect.objectContaining({ outboxId: "second" }));
  expect(sentIds[0]).toBe(statement.id);
  await request;
});
