import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLearningEventClientKey,
  createUniqueLearningEventKey,
  reportLearningEvent,
  resetReportedLearningEventsForTesting,
} from "@/lib/learning-records/client-event-reporter";
import type { LearningRecordEventInput } from "@/lib/learning-records/xapi-events";

const baseEvent: LearningRecordEventInput = {
  type: "activity.attempted",
  object: {
    id: "course-1/slides/slide-1/study-notes-export",
    name: "Study notes · Slide one",
  },
  context: {
    courseId: "course-1",
    locale: "zh-CN",
  },
};

describe("learning event client reporter", () => {
  afterEach(() => {
    resetReportedLearningEventsForTesting();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the learner event with keepalive and a JSON body", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "queued" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await reportLearningEvent({ actorId: "student-001", event: baseEvent });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/learning-records/events");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      actorId: "student-001",
      event: baseEvent,
    });
  });

  it("includes an explicit idempotency key when provided", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "queued" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await reportLearningEvent({
      actorId: "student-001",
      event: baseEvent,
      idempotencyKey: "custom-key-1",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ idempotencyKey: "custom-key-1" });
  });

  it("deduplicates repeat events with the same client key", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "queued" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await reportLearningEvent({ actorId: "student-001", event: baseEvent });
    await reportLearningEvent({ actorId: "student-001", event: baseEvent });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps client-side denials deduplicated but retries server failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "invalid" }, { status: 400 }))
      .mockResolvedValue(Response.json({ error: "upstream" }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await reportLearningEvent({ actorId: "student-001", event: baseEvent });
    await reportLearningEvent({ actorId: "student-001", event: baseEvent });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetReportedLearningEventsForTesting();
    await reportLearningEvent({ actorId: "student-001", event: baseEvent });
    await reportLearningEvent({ actorId: "student-001", event: baseEvent });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // E16/PKG-10: the dedupe key used to survive a session refusal for the whole
  // page session, so an expired cookie blackholed that event key permanently -
  // including after the learner had signed back in in another tab, when the very
  // next attempt would have been accepted.
  it.each([401, 403])(
    "clears the dedupe key on a %i so a re-authenticated learner can retry",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: "denied" }, { status }))
        .mockResolvedValue(Response.json({ status: "queued" }, { status: 202 }));
      vi.stubGlobal("fetch", fetchMock);

      await reportLearningEvent({ actorId: "student-001", event: baseEvent });
      await reportLearningEvent({ actorId: "student-001", event: baseEvent });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // And the accepted attempt re-arms the dedupe: one record, not a loop.
      await reportLearningEvent({ actorId: "student-001", event: baseEvent });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  // The other direction, kept exactly as designed: 424 means the deployment has
  // no LRS configured, which nothing the learner does will change.
  it("keeps a 424 deduplicated so an unconfigured LRS is not hammered", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "blocked" }, { status: 424 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await reportLearningEvent({ actorId: "student-001", event: baseEvent });
    await reportLearningEvent({ actorId: "student-001", event: baseEvent });
    await reportLearningEvent({ actorId: "student-001", event: baseEvent });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("swallows network failures and allows a later retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(Response.json({ status: "queued" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reportLearningEvent({ actorId: "student-001", event: baseEvent }),
    ).resolves.toBeUndefined();
    await reportLearningEvent({ actorId: "student-001", event: baseEvent });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("derives the default client key from actor, type, course, and object", () => {
    expect(createLearningEventClientKey({ actorId: "student-001", event: baseEvent })).toBe(
      "student-001:activity.attempted:course-1:course-1/slides/slide-1/study-notes-export",
    );
  });

  it("creates unique keys per invocation for repeatable events", () => {
    const first = createUniqueLearningEventKey("student-001", "ai.feedback.requested", "course-1");
    const second = createUniqueLearningEventKey("student-001", "ai.feedback.requested", "course-1");
    expect(first).toContain("student-001:ai.feedback.requested:course-1:");
    expect(first).not.toBe(second);
  });
});
