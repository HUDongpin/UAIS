// @vitest-environment node
import { Annotation, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLearningAiGuideHitlPostHandler,
  createScopedHitlThreadId,
} from "@/app/api/learning/ai-guide/hitl/handler";
import * as runtimeModule from "@/lib/ai/langgraph-runtime/runtime";
import type { UaisAppRole } from "@/lib/auth/uais-app-session";
import { createLearningGuideActor } from "@/lib/server/learning-guide-actor";
import { createUaisAppSessionCookie } from "@/lib/server/uais-app-session";

const env = {
  NODE_ENV: "test",
  UAIS_APP_SESSION_SIGNING_SECRET: "synthetic-hitl-review-signing-secret-32",
};
const threadId = "shared-client-thread";

function request(
  account: string,
  action: "start-review" | "resume-review",
  role: UaisAppRole = "student",
  sessionId = "synthetic-first-session",
) {
  return new Request("http://localhost/api/learning/ai-guide/hitl", {
    method: "POST",
    headers: {
      cookie: createUaisAppSessionCookie({
        account, role, displayName: "Synthetic learner", department: "Synthetic",
      }, { env, sessionId }),
    },
    body: JSON.stringify({
      action, threadId, messageText: "Owner's review", decision: "rejected",
    }),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("learning guide actor isolation", () => {
  it.each([
    [`${"a".repeat(72)}x`, `${"a".repeat(72)}y`],
    ["review+owner@example.test", "review-owner@example.test"],
  ])("prevents %s from sharing a review with %s", async (owner, other) => {
    const handler = createLearningAiGuideHitlPostHandler({ env });
    const started = await handler(request(owner, "start-review"));
    expect(started.status).toBe(200);

    const unauthorizedResume = await handler(request(other, "resume-review"));
    expect(unauthorizedResume.status).toBe(409);
    expect(await unauthorizedResume.json()).not.toHaveProperty("status", "completed");

    const ownResume = await handler(request(owner, "resume-review"));
    expect(ownResume.status).toBe(200);
    expect(await ownResume.json()).toMatchObject({
      status: "completed", humanInTheLoop: { decision: "rejected" },
    });
  });

  it("keeps the same canonical account resumable across sessions and casing", async () => {
    const handler = createLearningAiGuideHitlPostHandler({ env });
    expect((await handler(request("Student-A", "start-review"))).status).toBe(200);
    const resumed = await handler(request(
      "student-a", "resume-review", "student", "synthetic-next-session",
    ));
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ status: "completed" });
  });

  it("keeps different authenticated roles in separate review namespaces", async () => {
    const handler = createLearningAiGuideHitlPostHandler({ env });
    expect((await handler(request("same-account", "start-review"))).status).toBe(200);
    expect((await handler(request("same-account", "resume-review", "teacher"))).status).toBe(409);
    expect((await handler(request("same-account", "resume-review"))).status).toBe(200);
  });

  it("leaves legacy ambiguous checkpoints untouched instead of resuming them", async () => {
    const runtime = runtimeModule.createUaisLangGraphRuntime({ env });
    vi.spyOn(runtimeModule, "createUaisLangGraphRuntime").mockReturnValue(runtime);
    const State = Annotation.Root({
      messageText: Annotation<string>(),
      approvals: Annotation<string[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
    });
    const graph = new StateGraph(State)
      .addNode("human-review", () => ({
        approvals: [String(interrupt({ kind: "learning-guide-human-review", prompt: "Legacy review" }))],
      }))
      .addEdge(START, "human-review")
      .addEdge("human-review", END)
      .compile(runtime.createCompileOptions());
    const legacyActor = { actorId: "app-session-learner-student-a", role: "learner" as const };
    const legacyThread = createScopedHitlThreadId(legacyActor.actorId, threadId);
    expect((await runtime.run({
      graph, graphId: "learning-ai-guide-hitl", threadId: legacyThread,
      actor: legacyActor, input: { messageText: "Legacy review", approvals: [] },
    })).status).toBe("interrupted");

    const handler = createLearningAiGuideHitlPostHandler({ env });
    const legacyResume = await handler(request("student-a", "resume-review"));
    expect(legacyResume.status).toBe(409);
    expect(await legacyResume.json()).toMatchObject({
      error: "No pending learning AI guide review is available. Start a new human review.",
    });
    expect((await runtime.getSnapshot({
      graph, graphId: "learning-ai-guide-hitl", threadId: legacyThread,
    })).status).toBe("interrupted");
    expect((await handler(request("student-a", "start-review"))).status).toBe(200);
    expect((await handler(request("student-a", "resume-review"))).status).toBe(200);
  });

  it("uses a runtime-safe opaque identity for complete account values", () => {
    const actor = createLearningGuideActor({ account: "review+owner@example.test", role: "student" });
    expect(actor.actorId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    expect(actor.actorId).not.toContain("review");
    expect(actor.role).toBe("learner");
  });

  it("does not report completion for absent or already completed reviews", async () => {
    const handler = createLearningAiGuideHitlPostHandler({ env });
    expect((await handler(request("student-a", "resume-review"))).status).toBe(409);
    expect((await handler(request("student-a", "start-review"))).status).toBe(200);
    expect((await handler(request("student-a", "resume-review"))).status).toBe(200);
    expect((await handler(request("student-a", "resume-review"))).status).toBe(409);
  });
});
