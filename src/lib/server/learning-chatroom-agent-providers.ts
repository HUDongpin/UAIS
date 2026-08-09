import {
  createDeepSeekTextClient,
  deepSeekTimeoutErrorMessage,
  type DeepSeekCompleteInput,
  type DeepSeekCompleteResult,
} from "@/lib/ai/providers/deepseek-client";
import { createQwenMultimodalClient } from "@/lib/ai/providers/qwen-client";
import { getProviderForRole } from "@/lib/ai/providers/registry";

// Provider pool for chatroom agent turns.
//
// The room used to construct exactly one DeepSeek client and hand it to every
// agent, and to answer 503 for the whole round when `DEEPSEEK_API_KEY` was
// missing. That made four agents share one point of failure: a provider outage,
// a rate limit, or one absent key silenced the entire room.
//
// Here each agent names the provider role it prefers, and the pool holds a
// completer for every role the deployment has actually configured. A turn tries
// its own role first and then falls over to whatever else is configured, so a
// dead or throttled provider costs the room latency and a model change rather
// than the conversation. A round only fails outright when NO provider is
// configured at all.
//
// Qwen is reached through the multimodal client because that is the only chat
// entry point the provider module exposes; passing a plain string content is
// how the codebase already expresses "Qwen, but text only".

export type ChatroomAgentProviderRole = "text-reasoning" | "multimodal";

export type ChatroomAgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatroomAgentCompletion = {
  content: string;
  model: string;
  provider: "deepseek" | "qwen";
  role: ChatroomAgentProviderRole;
};

export type ChatroomAgentCompleter = (input: {
  messages: ChatroomAgentMessage[];
  maxTokens: number;
  timeoutMs: number;
}) => Promise<ChatroomAgentCompletion>;

export type ChatroomCompleterPool = Map<ChatroomAgentProviderRole, ChatroomAgentCompleter>;

export type ChatroomProviderFactories = {
  createDeepSeekTextClient?: (options: { apiKey: string; baseUrl?: string }) => {
    complete(input: DeepSeekCompleteInput): Promise<DeepSeekCompleteResult>;
  };
  createQwenMultimodalClient?: typeof createQwenMultimodalClient;
};

export function createLearningChatroomCompleterPool(input: {
  env: Record<string, string | undefined>;
  factories?: ChatroomProviderFactories;
}): ChatroomCompleterPool {
  const pool: ChatroomCompleterPool = new Map();
  const deepSeekFactory =
    input.factories?.createDeepSeekTextClient ?? createDeepSeekTextClient;
  const qwenFactory =
    input.factories?.createQwenMultimodalClient ?? createQwenMultimodalClient;

  // A role is present only when its key is, so an unconfigured provider is
  // simply absent from the pool rather than a client that throws on first use.
  const deepSeekApiKey = input.env.DEEPSEEK_API_KEY;
  if (deepSeekApiKey) {
    const provider = getProviderForRole("text-reasoning");
    const model = input.env.DEEPSEEK_MODEL ?? provider.defaultModel;
    const client = deepSeekFactory({
      apiKey: deepSeekApiKey,
      ...(input.env.DEEPSEEK_BASE_URL ? { baseUrl: input.env.DEEPSEEK_BASE_URL } : {}),
    });
    pool.set("text-reasoning", async ({ messages, maxTokens, timeoutMs }) => {
      const completion = await client.complete({
        model,
        maxTokens,
        timeoutMs,
        // `deepseek-v4-flash` is a hybrid thinking model: with a small token
        // budget an enabled thinking pass consumes the budget and returns empty
        // content, so the chatroom always disables it.
        thinking: { type: "disabled" },
        messages,
      });
      return {
        content: completion.content,
        model: completion.model,
        provider: "deepseek",
        role: "text-reasoning",
      };
    });
  }

  const dashscopeApiKey = input.env.DASHSCOPE_API_KEY;
  if (dashscopeApiKey) {
    const provider = getProviderForRole("multimodal");
    const model = input.env.QWEN_MULTIMODAL_MODEL ?? provider.defaultModel;
    const client = qwenFactory({
      apiKey: dashscopeApiKey,
      ...(input.env.DASHSCOPE_BASE_URL ? { baseUrl: input.env.DASHSCOPE_BASE_URL } : {}),
    });
    pool.set("multimodal", async ({ messages, maxTokens, timeoutMs }) => {
      // The Qwen client takes no per-call timeout, so the round's budget is
      // enforced here instead. Without this a slow Qwen turn would run past the
      // serverless wall and cost the learner the whole answered round, which is
      // exactly what the round budget exists to prevent.
      const completion = await withTimeout(
        client.complete({ model, maxTokens, enableThinking: false, messages }),
        timeoutMs,
      );
      return {
        content: completion.content,
        model: completion.model,
        provider: "qwen",
        role: "multimodal",
      };
    });
  }

  return pool;
}

/**
 * Runs one agent turn, preferring its own provider role and falling over to the
 * other configured roles in order.
 *
 * Every attempt is charged against the same remaining budget, and the caller's
 * `remainingMs` is re-read between attempts: a failover must not be able to push
 * the round past the deadline the route is holding.
 */
export async function completeChatroomAgentTurn(input: {
  pool: ChatroomCompleterPool;
  preferredRole: ChatroomAgentProviderRole;
  messages: ChatroomAgentMessage[];
  maxTokens: number;
  remainingMs: () => number;
  resolveTimeoutMs: (remainingMs: number) => number | undefined;
  onFailover?: (attempt: {
    role: ChatroomAgentProviderRole;
    nextRole: ChatroomAgentProviderRole;
    error: unknown;
  }) => void;
}): Promise<ChatroomAgentCompletion> {
  const roles = orderRolesForAgent(input.pool, input.preferredRole);
  if (roles.length === 0) {
    throw new Error("No learning chatroom provider is configured.");
  }

  let lastError: unknown;
  for (let index = 0; index < roles.length; index += 1) {
    const role = roles[index];
    const timeoutMs = input.resolveTimeoutMs(input.remainingMs());
    if (timeoutMs === undefined) {
      // Not enough of the round is left to start another call. Reporting the
      // previous failure (when there is one) keeps the turn's error honest.
      throw lastError ?? new Error(deepSeekTimeoutErrorMessage);
    }

    try {
      return await input.pool.get(role)!({
        messages: input.messages,
        maxTokens: input.maxTokens,
        timeoutMs,
      });
    } catch (error) {
      lastError = error;
      const nextRole = roles[index + 1];
      if (nextRole) {
        input.onFailover?.({ role, nextRole, error });
      }
    }
  }

  throw lastError ?? new Error("Learning chatroom provider call failed.");
}

// The agent's own role first, then every other configured role. Roles absent
// from the pool are skipped entirely rather than attempted and failed.
function orderRolesForAgent(
  pool: ChatroomCompleterPool,
  preferredRole: ChatroomAgentProviderRole,
): ChatroomAgentProviderRole[] {
  const ordered: ChatroomAgentProviderRole[] = [];
  if (pool.has(preferredRole)) {
    ordered.push(preferredRole);
  }
  for (const role of pool.keys()) {
    if (role !== preferredRole) {
      ordered.push(role);
    }
  }
  return ordered;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Reuses the DeepSeek timeout wording deliberately: the route classifies a
      // failed turn as "timeout" vs "provider" by comparing this exact message,
      // and a Qwen timeout is the same thing to a learner.
      reject(new Error(deepSeekTimeoutErrorMessage));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
