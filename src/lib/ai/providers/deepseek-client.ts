import { getProviderForRole } from "@/lib/ai/providers/registry";

export type DeepSeekChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekCompleteInput = {
  messages: DeepSeekChatMessage[];
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  thinking?: {
    type: "enabled" | "disabled";
  };
};

export type DeepSeekCompleteResult = {
  provider: "deepseek";
  model: string;
  content: string;
  usage?: {
    totalTokens?: number;
  };
};

export type DeepSeekTextClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type DeepSeekResponseBody = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_TIMEOUT_MS = 15000;

// Callers (the learning chatroom route) branch on this exact message to
// classify a failed agent turn as "timeout" instead of "provider".
export const deepSeekTimeoutErrorMessage = "DeepSeek request timed out.";

export function createDeepSeekTextClient(options: DeepSeekTextClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const provider = getProviderForRole("text-reasoning");
  const baseUrl = (options.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");

  return {
    async complete(input: DeepSeekCompleteInput): Promise<DeepSeekCompleteResult> {
      const model = input.model ?? provider.defaultModel;
      let response: Response;
      let rawBody: string;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: input.messages,
            max_tokens: input.maxTokens,
            thinking: input.thinking,
          }),
          signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_DEEPSEEK_TIMEOUT_MS),
        });
        // Read the body once as text; body streaming is also covered by the
        // timeout signal, so abort errors here map to the same timeout message.
        rawBody = await response.text();
      } catch (error) {
        if (isDeepSeekTimeoutLikeError(error)) {
          throw new Error(deepSeekTimeoutErrorMessage);
        }
        throw error;
      }

      // A gateway can answer with a non-JSON body (e.g. an HTML 502 page); that
      // must surface as a clean provider error, never a JSON SyntaxError.
      const body = parseDeepSeekResponseBody(rawBody);
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "DeepSeek request failed.");
      }

      return {
        provider: "deepseek",
        model,
        content: body?.choices?.[0]?.message?.content ?? "",
        usage: body?.usage
          ? {
              totalTokens: body.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}

function parseDeepSeekResponseBody(rawBody: string): DeepSeekResponseBody | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as DeepSeekResponseBody)
      : undefined;
  } catch {
    return undefined;
  }
}

// Abort failures are DOMExceptions, which are not `instanceof Error` in every
// runtime, so detect them by name. Undici also wraps some abort failures
// ("fetch failed") with the abort as `cause`.
function isDeepSeekTimeoutLikeError(error: unknown): boolean {
  return (
    hasDeepSeekAbortLikeName(error) ||
    (isRecordLike(error) && hasDeepSeekAbortLikeName(error.cause))
  );
}

function hasDeepSeekAbortLikeName(value: unknown): boolean {
  return (
    isRecordLike(value) && (value.name === "TimeoutError" || value.name === "AbortError")
  );
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
