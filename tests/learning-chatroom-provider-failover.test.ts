import { describe, expect, it } from "vitest";
import {
  completeChatroomAgentTurn,
  createLearningChatroomCompleterPool,
  type ChatroomCompleterPool,
} from "@/lib/server/learning-chatroom-agent-providers";
import { deepSeekTimeoutErrorMessage } from "@/lib/ai/providers/deepseek-client";

// Removes the room's single point of failure: four agents used to share one
// DeepSeek client, so an outage, a rate limit, or one absent key silenced every
// agent at once and answered 503 for the whole round.
//
// These assertions are about DEGRADATION, not about which model is nicer: a
// provider that dies must cost the room a model change, not the conversation.

const deepSeekApiKey = "secret-deepseek";
const dashscopeApiKey = "secret-dashscope";

function createStubDeepSeek(respond: () => string) {
  const calls: unknown[] = [];
  return {
    calls,
    factory: () => ({
      complete: async (input: unknown) => {
        calls.push(input);
        return {
          provider: "deepseek" as const,
          model: "deepseek-v4-flash",
          content: respond(),
        };
      },
    }),
  };
}

function createStubQwen(respond: () => string) {
  const calls: unknown[] = [];
  return {
    calls,
    factory: () => ({
      complete: async (input: unknown) => {
        calls.push(input);
        return {
          provider: "qwen" as const,
          providerRole: "multimodal" as const,
          model: "qwen3.5-omni-plus",
          content: respond(),
        };
      },
    }),
  };
}

// Mirrors the route's own budget resolver closely enough to exercise the
// exhaustion branch without importing route internals.
function resolveTimeoutMs(remainingMs: number) {
  const usable = remainingMs - 2000;
  if (usable < 3000) {
    return undefined;
  }
  return Math.min(usable, 15000);
}

function runTurn(pool: ChatroomCompleterPool, overrides: Partial<Parameters<typeof completeChatroomAgentTurn>[0]> = {}) {
  return completeChatroomAgentTurn({
    pool,
    preferredRole: "text-reasoning",
    messages: [{ role: "user", content: "@研究助教 变量怎么定？" }],
    maxTokens: 512,
    remainingMs: () => 45000,
    resolveTimeoutMs,
    ...overrides,
  });
}

describe("learning chatroom completer pool", () => {
  it("holds only the roles the deployment configured", () => {
    expect(
      createLearningChatroomCompleterPool({ env: { DEEPSEEK_API_KEY: deepSeekApiKey } }).size,
    ).toBe(1);
    expect(
      createLearningChatroomCompleterPool({ env: { DASHSCOPE_API_KEY: dashscopeApiKey } }).size,
    ).toBe(1);
    expect(
      createLearningChatroomCompleterPool({
        env: { DEEPSEEK_API_KEY: deepSeekApiKey, DASHSCOPE_API_KEY: dashscopeApiKey },
      }).size,
    ).toBe(2);
    // Nothing configured is the only case the route may refuse outright.
    expect(createLearningChatroomCompleterPool({ env: {} }).size).toBe(0);
  });

  it("answers from the agent's own provider when it is healthy", async () => {
    const deepSeek = createStubDeepSeek(() => "研究助教的回答");
    const qwen = createStubQwen(() => "should not be reached");
    const pool = createLearningChatroomCompleterPool({
      env: { DEEPSEEK_API_KEY: deepSeekApiKey, DASHSCOPE_API_KEY: dashscopeApiKey },
      factories: {
        createDeepSeekTextClient: deepSeek.factory,
        createQwenMultimodalClient: qwen.factory as never,
      },
    });

    const completion = await runTurn(pool);

    expect(completion.provider).toBe("deepseek");
    expect(completion.content).toBe("研究助教的回答");
    // A healthy preferred provider must not fan out to the others.
    expect(qwen.calls).toHaveLength(0);
  });

  it("falls over to the other provider when the preferred one dies", async () => {
    const deepSeek = {
      factory: () => ({
        complete: async () => {
          throw new Error("DeepSeek request failed.");
        },
      }),
    };
    const qwen = createStubQwen(() => "研究助教的回答（Qwen）");
    const failovers: Array<{ role: string; nextRole: string }> = [];

    const pool = createLearningChatroomCompleterPool({
      env: { DEEPSEEK_API_KEY: deepSeekApiKey, DASHSCOPE_API_KEY: dashscopeApiKey },
      factories: {
        createDeepSeekTextClient: deepSeek.factory as never,
        createQwenMultimodalClient: qwen.factory as never,
      },
    });

    const completion = await runTurn(pool, {
      onFailover: ({ role, nextRole }) => failovers.push({ role, nextRole }),
    });

    // The learner still gets an answer; only the model behind it changed.
    expect(completion.provider).toBe("qwen");
    expect(completion.content).toBe("研究助教的回答（Qwen）");
    expect(failovers).toEqual([{ role: "text-reasoning", nextRole: "multimodal" }]);
  });

  it("serves an agent whose preferred provider is not configured at all", async () => {
    const qwen = createStubQwen(() => "Qwen 兜底回答");
    const pool = createLearningChatroomCompleterPool({
      // DeepSeek key absent entirely - the old code answered 503 for the whole
      // round here, silencing all four agents.
      env: { DASHSCOPE_API_KEY: dashscopeApiKey },
      factories: { createQwenMultimodalClient: qwen.factory as never },
    });

    const completion = await runTurn(pool);
    expect(completion.provider).toBe("qwen");
    expect(qwen.calls).toHaveLength(1);
  });

  it("reports the last failure when every configured provider fails", async () => {
    const failing = () => ({
      complete: async () => {
        throw new Error("DeepSeek request failed.");
      },
    });
    const pool = createLearningChatroomCompleterPool({
      env: { DEEPSEEK_API_KEY: deepSeekApiKey, DASHSCOPE_API_KEY: dashscopeApiKey },
      factories: {
        createDeepSeekTextClient: failing as never,
        createQwenMultimodalClient: failing as never,
      },
    });

    await expect(runTurn(pool)).rejects.toThrow(/failed/);
  });

  it("does not start a failover the round budget cannot fund", async () => {
    const qwen = createStubQwen(() => "must not be reached");
    const deepSeek = {
      factory: () => ({
        complete: async () => {
          throw new Error("DeepSeek request failed.");
        },
      }),
    };
    const pool = createLearningChatroomCompleterPool({
      env: { DEEPSEEK_API_KEY: deepSeekApiKey, DASHSCOPE_API_KEY: dashscopeApiKey },
      factories: {
        createDeepSeekTextClient: deepSeek.factory as never,
        createQwenMultimodalClient: qwen.factory as never,
      },
    });

    // First attempt is affordable; by the retry the round is spent. A failover
    // must never push the round past the deadline the route is holding.
    const remaining = [45000, 1000];
    await expect(
      runTurn(pool, { remainingMs: () => remaining.shift() ?? 0 }),
    ).rejects.toThrow(/failed/);
    expect(qwen.calls).toHaveLength(0);
  });

  it("bounds a Qwen call with the round budget the client itself does not enforce", async () => {
    const pool = createLearningChatroomCompleterPool({
      env: { DASHSCOPE_API_KEY: dashscopeApiKey },
      factories: {
        createQwenMultimodalClient: (() => ({
          // Never settles: without the route-side race this would run past the
          // serverless wall and cost the learner an already-answered round.
          complete: () => new Promise(() => {}),
        })) as never,
      },
    });

    await expect(
      completeChatroomAgentTurn({
        pool,
        preferredRole: "multimodal",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 512,
        remainingMs: () => 45000,
        // A tiny timeout so the assertion does not wait on the real budget.
        resolveTimeoutMs: () => 25,
      }),
      // Classified as a timeout by the exact message the route branches on.
    ).rejects.toThrow(deepSeekTimeoutErrorMessage);
  });
});
