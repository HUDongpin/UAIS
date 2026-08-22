import { describe, expect, it, vi } from "vitest";
import {
  createLearningOutboxDispatchPostHandler,
  createLearningOutboxReplayPostHandler,
} from "./helpers/learning-loop-route-factories";

const secret = "0123456789abcdef0123456789abcdef";
const env = {
  UAIS_LEARNING_RECORD_OUTBOX_SECRET: secret,
  UAIS_CORE_DATABASE_URL: "postgres://redacted@example.test/uais",
};

function request(presentedSecret?: string) {
  return new Request("http://localhost/api/learning-records/outbox/dispatch?limit=40", {
    method: "POST",
    headers: presentedSecret
      ? { authorization: `Bearer ${presentedSecret}`, "x-uais-trace-id": "trace-outbox-1" }
      : {},
  });
}

describe("P1 protected learning-record outbox route", () => {
  it("rejects a missing or incorrect bearer secret before dispatch", async () => {
    const dispatch = vi.fn();
    const handler = createLearningOutboxDispatchPostHandler({ env, dispatch });

    const missing = await handler(request());
    const incorrect = await handler(request(`${secret}x`));

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(await incorrect.json())).not.toContain(secret);
  });

  it("dispatches a bounded batch and returns only redacted counters", async () => {
    const dispatch = vi.fn(async () => ({
      target: "learning-xapi-outbox" as const,
      status: "processed" as const,
      claimed: 3,
      sent: 2,
      failed: 1,
      dead: 0,
      valueRedacted: true as const,
    }));
    const handler = createLearningOutboxDispatchPostHandler({
      env,
      dispatch,
      createWorkerId: () => "outbox-worker-test-1",
    });

    const response = await handler(request(secret));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "processed",
      claimed: 3,
      sent: 2,
      failed: 1,
      dead: 0,
      traceId: "trace-outbox-1",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        env,
        workerId: "outbox-worker-test-1",
        limit: 40,
      }),
    );
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain("student");
  });

  it("fails closed when the configured secret is absent or too short", async () => {
    const dispatch = vi.fn();
    const handler = createLearningOutboxDispatchPostHandler({
      env: { UAIS_LEARNING_RECORD_OUTBOX_SECRET: "short" },
      dispatch,
    });

    const response = await handler(request("short"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "blocked",
      reasonCode: "outbox-secret-not-configured",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("P1 explicit dead-letter replay route", () => {
  const outboxId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("requires the protected server secret before reading the replay body", async () => {
    const replayDead = vi.fn(async () => undefined);
    const handler = createLearningOutboxReplayPostHandler({ env, replayDead });
    const response = await handler(
      new Request("http://localhost/api/learning-records/outbox/replay", {
        method: "POST",
        body: JSON.stringify({ outboxId }),
      }),
    );
    expect(response.status).toBe(401);
    expect(replayDead).not.toHaveBeenCalled();
  });

  it("moves one explicit dead row back to pending with a redacted receipt", async () => {
    const replayDead = vi.fn(async () => undefined);
    const handler = createLearningOutboxReplayPostHandler({
      env,
      now: () => new Date("2026-08-21T01:00:00.000Z"),
      replayDead,
    });
    const response = await handler(
      new Request("http://localhost/api/learning-records/outbox/replay", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "x-uais-trace-id": "trace-replay-1",
        },
        body: JSON.stringify({ outboxId }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "persisted",
      resourceId: outboxId,
      state: "pending",
      traceId: "trace-replay-1",
      valueRedacted: true,
    });
    expect(replayDead).toHaveBeenCalledWith({
      outboxId,
      replayedAt: "2026-08-21T01:00:00.000Z",
    });
  });
});
