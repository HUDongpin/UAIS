import { describe, expect, it, vi } from "vitest";
import {
  classifyLearningOutboxBacklog,
  dispatchLearningOutboxBatch,
  isLearningOutboxSecretAuthorized,
  type ClaimedLearningOutboxItem,
} from "@/lib/learning-loop/outbox-worker";

const item: ClaimedLearningOutboxItem = {
  outboxId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  learningEventId: "99999999-9999-4999-8999-999999999999",
  statementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  attemptCount: 0,
  actorId: "22222222-2222-4222-8222-222222222222",
  actorRole: "student",
  eventType: "submission.submitted",
  objectId: "submission:777:v1",
  objectName: "Structured learning submission",
  courseExternalId: "course-1",
  classExternalId: "class-1",
  lessonKey: "lesson-1",
  context: {
    versionNo: 1,
    rubricDimensionIds: ["accuracy", "relationships"],
  },
  occurredAt: "2026-08-20T18:00:00.000Z",
};

const readyEnv = {
  UAIS_LRS_ENDPOINT: "https://lrs.example.test/xapi",
  UAIS_LRS_USERNAME: "redacted-user",
  UAIS_LRS_PASSWORD: "redacted-password",
};

describe("P1 durable xAPI outbox worker", () => {
  it("sends a deterministic redacted statement and marks the row sent", async () => {
    const markSent = vi.fn(async () => undefined);
    const markFailed = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const statement = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(statement.id).toBe(item.statementId);
      expect(JSON.stringify(statement)).toContain(item.actorId);
      expect(JSON.stringify(statement)).not.toContain("student-1");
      expect(JSON.stringify(statement)).not.toContain("student private body");
      expect(JSON.stringify(statement)).not.toContain("teacher feedback body");
      expect(JSON.stringify(statement)).toContain("accuracy");
      return new Response(JSON.stringify([item.statementId]), { status: 200 });
    });

    const result = await dispatchLearningOutboxBatch({
      env: readyEnv,
      fetch: fetchMock as typeof fetch,
      workerId: "worker-1",
      store: {
        claimBatch: async () => [item],
        markSent,
        markFailed,
        readOutboxBacklog: async () => ({
          pendingCount: 2,
          deadCount: 0,
          maxAgeSeconds: 901,
        }),
      },
      now: () => new Date("2026-08-20T18:01:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "processed",
      claimed: 1,
      sent: 1,
      failed: 0,
      dead: 0,
      backlog: { pendingCount: 2, deadCount: 0, maxAgeSeconds: 901 },
      backlogStatus: "warning",
    });
    expect(markSent).toHaveBeenCalledWith({
      outboxId: item.outboxId,
      workerId: "worker-1",
      sentAt: "2026-08-20T18:01:00.000Z",
    });
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("keeps LRS configuration failure off the classroom path and does not claim rows", async () => {
    const claimBatch = vi.fn(async () => [item]);
    const result = await dispatchLearningOutboxBatch({
      env: {},
      workerId: "worker-1",
      store: {
        claimBatch,
        markSent: async () => undefined,
        markFailed: async () => undefined,
      },
    });

    expect(result).toMatchObject({ status: "blocked", reasonCode: "lrs-not-configured" });
    expect(claimBatch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("records a redacted failure category and fixed retry time without automatic request fan-out", async () => {
    const markFailed = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));

    const result = await dispatchLearningOutboxBatch({
      env: readyEnv,
      fetch: fetchMock as typeof fetch,
      workerId: "worker-1",
      store: {
        claimBatch: async () => [{ ...item, attemptCount: 1 }],
        markSent: async () => undefined,
        markFailed,
      },
      now: () => new Date("2026-08-20T18:02:00.000Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "processed", claimed: 1, sent: 0, failed: 1 });
    expect(markFailed).toHaveBeenCalledWith({
      outboxId: item.outboxId,
      workerId: "worker-1",
      status: "failed",
      attemptCount: 2,
      errorCategory: "lrs-http-429",
      nextAttemptAt: "2026-08-20T18:07:00.000Z",
    });
  });

  it("marks the tenth failed delivery dead and classifies warning/critical backlog", async () => {
    const markFailed = vi.fn(async () => undefined);
    await dispatchLearningOutboxBatch({
      env: readyEnv,
      fetch: (async () => new Response("unavailable", { status: 503 })) as typeof fetch,
      workerId: "worker-1",
      store: {
        claimBatch: async () => [{ ...item, attemptCount: 9 }],
        markSent: async () => undefined,
        markFailed,
      },
      now: () => new Date("2026-08-20T18:03:00.000Z"),
    });
    expect(markFailed).toHaveBeenCalledWith({
      outboxId: item.outboxId,
      workerId: "worker-1",
      status: "dead",
      attemptCount: 10,
      errorCategory: "lrs-http-503",
      nextAttemptAt: "2026-08-21T00:03:00.000Z",
    });

    expect(classifyLearningOutboxBacklog({ pendingCount: 2, deadCount: 0, maxAgeSeconds: 901 })).toBe(
      "warning",
    );
    expect(classifyLearningOutboxBacklog({ pendingCount: 1, deadCount: 0, maxAgeSeconds: 3601 })).toBe(
      "critical",
    );
    expect(classifyLearningOutboxBacklog({ pendingCount: 0, deadCount: 1, maxAgeSeconds: 0 })).toBe(
      "critical",
    );
  });

  it("requires a configured outbox secret of at least 32 characters and constant-time equality", () => {
    const secret = "0123456789abcdef0123456789abcdef";
    expect(isLearningOutboxSecretAuthorized(secret, secret)).toBe(true);
    expect(isLearningOutboxSecretAuthorized(`${secret}x`, secret)).toBe(false);
    expect(isLearningOutboxSecretAuthorized("short", "short")).toBe(false);
    expect(isLearningOutboxSecretAuthorized(undefined, secret)).toBe(false);
  });
});
