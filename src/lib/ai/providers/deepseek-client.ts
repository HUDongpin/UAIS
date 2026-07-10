import { getProviderForRole } from "@/lib/ai/providers/registry";

export type DeepSeekChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekCompleteInput = {
  messages: DeepSeekChatMessage[];
  model?: string;
  maxTokens?: number;
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

export function createDeepSeekTextClient(options: DeepSeekTextClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const provider = getProviderForRole("text-reasoning");
  const baseUrl = (options.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");

  return {
    async complete(input: DeepSeekCompleteInput): Promise<DeepSeekCompleteResult> {
      const model = input.model ?? provider.defaultModel;
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
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
      });

      const body = (await response.json()) as DeepSeekResponseBody;
      if (!response.ok) {
        throw new Error(body.error?.message ?? "DeepSeek request failed.");
      }

      return {
        provider: "deepseek",
        model,
        content: body.choices?.[0]?.message?.content ?? "",
        usage: body.usage
          ? {
              totalTokens: body.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}
