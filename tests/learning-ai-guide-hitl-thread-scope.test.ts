import { describe, expect, it } from "vitest";
import { createScopedHitlThreadId } from "@/app/api/learning/ai-guide/hitl/route";

// The LangGraph runtime only accepts thread ids matching this shape.
const safeThreadIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

describe("HITL review thread scoping", () => {
  it("gives different learners different runtime threads for the same client threadId", () => {
    const learnerA = createScopedHitlThreadId("app-session-learner-peter", "shared-thread");
    const learnerB = createScopedHitlThreadId("app-session-learner-mallory", "shared-thread");

    expect(learnerA).not.toBe(learnerB);
  });

  it("is deterministic per actor so the same learner can resume their own review", () => {
    const first = createScopedHitlThreadId("app-session-learner-peter", "shared-thread");
    const second = createScopedHitlThreadId("app-session-learner-peter", "shared-thread");

    expect(first).toBe(second);
  });

  it("separates distinct client threadIds for the same learner", () => {
    const threadOne = createScopedHitlThreadId("app-session-learner-peter", "thread-1");
    const threadTwo = createScopedHitlThreadId("app-session-learner-peter", "thread-2");

    expect(threadOne).not.toBe(threadTwo);
  });

  it("always produces a runtime-safe thread id", () => {
    const scoped = createScopedHitlThreadId(
      "app-session-learner-peter",
      "learning-guide-thread-001",
    );

    expect(scoped).toMatch(safeThreadIdPattern);
  });
});
