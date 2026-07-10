import { getProviderForRole } from "@/lib/ai/providers/registry";
import { QWEN_REALTIME_VOICE_CLONE_MODEL } from "@/lib/ai/providers/qwen-models";
import {
  createPptNarrationAudioManifest,
  type PptNarrationAudioManifest,
  type PptNarrationRequest,
} from "@/lib/ai/voice/ppt-narration";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export type QwenVoiceClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  WebSocketCtor?: QwenRealtimeWebSocketConstructor;
};

export type QwenImageClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export type QwenMultimodalContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export type QwenMultimodalChatMessage = {
  role: "system" | "user" | "assistant";
  content: QwenMultimodalContent;
};

export type QwenMultimodalCompleteInput = {
  messages: QwenMultimodalChatMessage[];
  model?: string;
  maxTokens?: number;
  enableThinking?: boolean;
};

export type QwenMultimodalCompleteResult = {
  provider: "qwen";
  providerRole: "multimodal";
  model: string;
  content: string;
  usage?: {
    totalTokens?: number;
  };
};

export type QwenCourseCoverGenerateInput = {
  courseName: string;
  instructor?: string;
  unit?: string;
  department?: string;
  semester?: string;
  description?: string;
  model?: string;
  prompt?: string;
  size?: string;
  negativePrompt?: string;
};

export type QwenCourseCoverGenerateResult = {
  provider: "qwen";
  providerRole: "image-generation";
  model: string;
  imageUrl: string;
  requestId?: string;
  usage?: {
    width?: number;
    height?: number;
    imageCount?: number;
  };
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "generated-url-only";
  };
};

export type QwenVoiceCloneSubmitInput = {
  teacherId: string;
  sampleAssetId: string;
  sampleDurationSeconds: number;
  targetVoiceLabel: string;
  preferredVoiceName?: string;
  sampleAudioDataUrl?: string;
  sampleText?: string;
  languageHint?: string;
  targetModel?: string;
};

export type QwenTaskSubmitResult = {
  provider: "qwen";
  taskId: string;
  requestId?: string;
  status: "submitted";
  clonedVoiceId?: string;
  targetModel?: string;
};

export type QwenVoiceCloneTaskStatusResult = {
  provider: "qwen";
  providerTaskId: string;
  providerStatus: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  clonedVoiceId?: string;
  requestId?: string;
};

export type QwenClonedVoiceRevokeResult = {
  provider: "qwen";
  providerRole: "voice-clone";
  status: "revoked";
  requestId?: string;
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

export type QwenPptNarrationAudioSegmentResult = {
  slideId: string;
  audioId: string;
  audioBase64: string;
  byteLength: number;
  format: "pcm";
  sampleRateHz: 24000;
};

export type QwenPptNarrationSubmitResult = {
  provider: "qwen";
  taskId: string;
  status: "submitted";
  targetModel: string;
  audioManifest: PptNarrationAudioManifest;
  audioSegments: QwenPptNarrationAudioSegmentResult[];
};

export type QwenRealtimeWebSocketLike = {
  on(event: string, listener: (payload?: unknown) => void): QwenRealtimeWebSocketLike;
  send(data: string): void;
  close(): void;
};

export type QwenRealtimeWebSocketConstructor = new (
  url: string,
  options?: { headers?: Record<string, string> },
) => QwenRealtimeWebSocketLike;

type QwenTaskResponseBody = {
  output?: {
    task_id?: string;
    task_status?: string;
    status?: string;
    cloned_voice_id?: string;
    voice_id?: string;
    voice?: string;
    target_model?: string;
  };
  request_id?: string;
  message?: string;
};

type QwenImageResponseBody = {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{
          image?: string;
        }>;
      };
    }>;
  };
  usage?: {
    width?: number;
    height?: number;
    image_count?: number;
  };
  request_id?: string;
  code?: string;
  message?: string;
};

type QwenCompatibleChatResponseBody = {
  choices?: Array<{
    message?: {
      content?: QwenCompatibleMessageContent;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
  message?: string;
};

type QwenCompatibleChatStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: QwenCompatibleMessageContent;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
  message?: string;
};

type QwenCompatibleMessageContent = string | Array<{ text?: string }> | undefined;

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";
const QWEN_REALTIME_SAMPLE_RATE_HZ = 24000;
const QWEN_COURSE_COVER_SIZE = "800*480";
const QWEN_COURSE_COVER_NEGATIVE_PROMPT =
  "Low resolution, blurry text, watermark, logo, distorted hands, distorted faces, cluttered layout, oversaturated colors, childish cartoon style.";

export function createQwenMultimodalClient(options: QwenImageClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const provider = getProviderForRole("multimodal");
  const baseUrl = toQwenCompatibleBaseUrl(options.baseUrl ?? DEFAULT_DASHSCOPE_BASE_URL);

  return {
    async complete(
      input: QwenMultimodalCompleteInput,
    ): Promise<QwenMultimodalCompleteResult> {
      const model = input.model ?? provider.defaultModel;
      const stream = isQwenOmniModel(model);
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
          enable_thinking: input.enableThinking,
          stream,
          ...(stream ? { stream_options: { include_usage: true } } : {}),
        }),
      });

      if (stream) {
        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(readQwenCompatibleErrorMessage(responseText));
        }

        const streamedCompletion = readQwenCompatibleStream(responseText);
        return {
          provider: "qwen",
          providerRole: "multimodal",
          model,
          content: streamedCompletion.content,
          usage:
            streamedCompletion.totalTokens === undefined
              ? undefined
              : { totalTokens: streamedCompletion.totalTokens },
        };
      }

      const body = (await response.json()) as QwenCompatibleChatResponseBody;
      if (!response.ok) {
        throw new Error(
          body.error?.message ?? body.message ?? "Qwen multimodal request failed.",
        );
      }

      return {
        provider: "qwen",
        providerRole: "multimodal",
        model,
        content: readQwenCompatibleMessageContent(body.choices?.[0]?.message?.content),
        usage: body.usage
          ? {
              totalTokens: body.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}

export function createQwenImageClient(options: QwenImageClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_DASHSCOPE_BASE_URL).replace(/\/$/, "");

  return {
    async generateCourseCover(
      input: QwenCourseCoverGenerateInput,
    ): Promise<QwenCourseCoverGenerateResult> {
      const provider = getProviderForRole("image-generation");
      const model = input.model ?? provider.defaultModel;
      const response = await fetchImpl(
        `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: {
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      text: input.prompt ?? createCourseCoverPrompt(input),
                    },
                  ],
                },
              ],
            },
            parameters: {
              negative_prompt: input.negativePrompt ?? QWEN_COURSE_COVER_NEGATIVE_PROMPT,
              prompt_extend: true,
              watermark: false,
              size: input.size ?? QWEN_COURSE_COVER_SIZE,
            },
          }),
        },
      );
      const responseBody = (await response.json()) as QwenImageResponseBody;

      if (!response.ok) {
        throw new Error(responseBody.message ?? "Qwen course cover generation failed.");
      }

      const imageUrl = responseBody.output?.choices?.[0]?.message?.content?.find(
        (content) => typeof content.image === "string" && content.image.length > 0,
      )?.image;
      if (!imageUrl) {
        throw new Error("Qwen course cover generation did not return an image URL.");
      }

      return {
        provider: "qwen",
        providerRole: "image-generation",
        model,
        imageUrl,
        requestId: responseBody.request_id,
        usage: {
          width: responseBody.usage?.width,
          height: responseBody.usage?.height,
          imageCount: responseBody.usage?.image_count,
        },
        redaction: createImageRedaction(),
      };
    },
  };
}

function toQwenCompatibleBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/compatible-mode/v1")
    ? normalized
    : `${normalized}/compatible-mode/v1`;
}

function isQwenOmniModel(model: string) {
  return /(?:^|-)omni(?:-|$)/i.test(model);
}

function readQwenCompatibleStream(responseText: string) {
  let content = "";
  let totalTokens: number | undefined;

  for (const line of responseText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    let chunk: QwenCompatibleChatStreamChunk;
    try {
      chunk = JSON.parse(data) as QwenCompatibleChatStreamChunk;
    } catch {
      throw new Error("Qwen multimodal stream returned invalid SSE data.");
    }

    if (chunk.error?.message || chunk.message) {
      throw new Error(chunk.error?.message ?? chunk.message);
    }

    content += readQwenCompatibleMessageContent(chunk.choices?.[0]?.delta?.content);
    if (typeof chunk.usage?.total_tokens === "number") {
      totalTokens = chunk.usage.total_tokens;
    }
  }

  return { content, totalTokens };
}

function readQwenCompatibleErrorMessage(responseText: string) {
  try {
    const body = JSON.parse(responseText) as QwenCompatibleChatResponseBody;
    return body.error?.message ?? body.message ?? "Qwen multimodal request failed.";
  } catch {
    return "Qwen multimodal request failed.";
  }
}

function readQwenCompatibleMessageContent(content: QwenCompatibleMessageContent) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text)
      .filter((text): text is string => typeof text === "string" && text.length > 0)
      .join("\n");
  }

  return "";
}

export function createQwenVoiceClient(options: QwenVoiceClientOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_DASHSCOPE_BASE_URL).replace(/\/$/, "");
  const WebSocketCtor = options.WebSocketCtor ?? (WebSocket as unknown as QwenRealtimeWebSocketConstructor);

  return {
    submitVoiceClone(input: QwenVoiceCloneSubmitInput) {
      return submitVoiceEnrollment(
        fetchImpl,
        options.apiKey,
        `${baseUrl}/api/v1/services/audio/tts/customization`,
        {
          model: "qwen-voice-enrollment",
          input: {
            action: "create",
            target_model: input.targetModel ?? QWEN_REALTIME_VOICE_CLONE_MODEL,
            preferred_name: createPreferredVoiceName(input.preferredVoiceName ?? input.targetVoiceLabel),
            audio: {
              data: requireAudioDataUrl(input.sampleAudioDataUrl),
            },
            ...(input.sampleText ? { text: input.sampleText } : {}),
            ...(input.languageHint ? { language: input.languageHint } : {}),
          },
        },
      );
    },
    async submitPptNarration(input: PptNarrationRequest): Promise<QwenPptNarrationSubmitResult> {
      const provider = getProviderForRole("ppt-narration");
      const targetModel = input.targetModel ?? provider.defaultModel;
      const audioManifest = createPptNarrationAudioManifest({
        ...input,
        targetModel,
      });
      const audioSegments: QwenPptNarrationAudioSegmentResult[] = [];

      for (const segment of audioManifest.segments) {
        const audio = await synthesizeRealtimeSpeech({
          apiKey: options.apiKey,
          baseUrl,
          WebSocketCtor,
          model: targetModel,
          voice: input.clonedVoiceId,
          text: segment.narrationText,
          language: input.language,
        });
        audioSegments.push({
          slideId: segment.slideId,
          audioId: segment.audioId,
          audioBase64: audio.audioBase64,
          byteLength: audio.byteLength,
          format: "pcm",
          sampleRateHz: 24000,
        });
      }

      return {
        provider: "qwen",
        taskId: audioManifest.id,
        status: "submitted",
        targetModel,
        audioManifest,
        audioSegments,
      };
    },
    async getVoiceCloneTaskStatus(taskId: string): Promise<QwenVoiceCloneTaskStatusResult> {
      const response = await fetchImpl(`${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
      });
      const responseBody = (await response.json()) as QwenTaskResponseBody;

      if (!response.ok) {
        throw new Error(responseBody.message ?? "Qwen task status request failed.");
      }

      return {
        provider: "qwen",
        providerTaskId: taskId,
        providerStatus: normalizeTaskStatus(
          responseBody.output?.task_status ?? responseBody.output?.status,
        ),
        clonedVoiceId: responseBody.output?.cloned_voice_id ?? responseBody.output?.voice_id,
        requestId: responseBody.request_id,
      };
    },
    revokeClonedVoice(clonedVoiceId: string): Promise<QwenClonedVoiceRevokeResult> {
      return deleteVoiceEnrollment(
        fetchImpl,
        options.apiKey,
        `${baseUrl}/api/v1/services/audio/tts/customization`,
        clonedVoiceId,
      );
    },
  };
}

function normalizeTaskStatus(
  status: string | undefined,
): QwenVoiceCloneTaskStatusResult["providerStatus"] {
  if (
    status === "PENDING" ||
    status === "RUNNING" ||
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELED"
  ) {
    return status;
  }

  return "RUNNING";
}

async function submitVoiceEnrollment(
  fetchImpl: typeof fetch,
  apiKey: string,
  url: string,
  body: Record<string, unknown>,
): Promise<QwenTaskSubmitResult> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const responseBody = (await response.json()) as QwenTaskResponseBody;

  if (!response.ok) {
    throw new Error(responseBody.message ?? "Qwen voice enrollment failed.");
  }

  const clonedVoiceId = responseBody.output?.voice ?? responseBody.output?.voice_id;

  return {
    provider: "qwen",
    taskId: clonedVoiceId ?? "",
    requestId: responseBody.request_id,
    status: "submitted",
    clonedVoiceId,
    targetModel: responseBody.output?.target_model,
  };
}

function requireAudioDataUrl(value: string | undefined) {
  if (!value?.startsWith("data:audio/")) {
    throw new Error("Qwen voice enrollment requires an audio data URL.");
  }

  return value;
}

function createPreferredVoiceName(label: string) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);

  return normalized || "uais_voice";
}

async function deleteVoiceEnrollment(
  fetchImpl: typeof fetch,
  apiKey: string,
  url: string,
  clonedVoiceId: string,
): Promise<QwenClonedVoiceRevokeResult> {
  if (!clonedVoiceId.trim()) {
    throw new Error("Qwen cloned voice id is required for revoke.");
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "qwen-voice-enrollment",
      input: {
        action: "delete",
        voice: clonedVoiceId,
      },
    }),
  });
  const responseBody = (await response.json()) as QwenTaskResponseBody;

  if (!response.ok) {
    throw new Error("Qwen cloned voice revoke failed.");
  }

  return {
    provider: "qwen",
    providerRole: "voice-clone",
    status: "revoked",
    requestId: responseBody.request_id,
    redaction: createRedaction(),
  };
}

function createRedaction(): QwenClonedVoiceRevokeResult["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function createImageRedaction(): QwenCourseCoverGenerateResult["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "generated-url-only",
  };
}

function createCourseCoverPrompt(input: QwenCourseCoverGenerateInput) {
  const details = [
    `Course title: ${input.courseName.trim()}`,
    input.description ? `Course description: ${input.description.trim()}` : undefined,
    input.instructor ? `Instructor: ${input.instructor.trim()}` : undefined,
    input.department ? `Department: ${input.department.trim()}` : undefined,
    input.unit ? `University unit: ${input.unit.trim()}` : undefined,
    input.semester ? `Semester: ${input.semester.trim()}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "Create a refined 800 by 480 university course cover for a teaching management system.",
    "Use a professional academic visual language with clean composition, subtle depth, and enough empty space for UI cropping.",
    "Avoid logos, faces, readable institutional seals, private identity marks, and dense text.",
    "Theme the imagery around the course details below while keeping it suitable for university faculty and students.",
    details,
  ].join("\n");
}

type RealtimeSpeechInput = {
  apiKey: string;
  baseUrl: string;
  WebSocketCtor: QwenRealtimeWebSocketConstructor;
  model: string;
  voice: string;
  text: string;
  language: PptNarrationRequest["language"];
};

type RealtimeSpeechOutput = {
  audioBase64: string;
  byteLength: number;
};

function synthesizeRealtimeSpeech(input: RealtimeSpeechInput): Promise<RealtimeSpeechOutput> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const socket = new input.WebSocketCtor(buildRealtimeWebSocketUrl(input.baseUrl, input.model), {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    });
    const timeout = setTimeout(() => {
      rejectOnce(new Error("Qwen realtime TTS timed out before response.done."));
    }, 60_000);

    function rejectOnce(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Ignore close failures during error cleanup.
      }
      reject(error);
    }

    function resolveOnce() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const audio = Buffer.concat(chunks);
      try {
        sendRealtimeEvent(socket, { type: "session.finish" });
        socket.close();
      } catch {
        // The audio is complete after response.done; close best-effort.
      }
      resolve({
        audioBase64: audio.toString("base64"),
        byteLength: audio.byteLength,
      });
    }

    socket.on("open", () => {
      sendRealtimeEvent(socket, {
        type: "session.update",
        session: {
          voice: input.voice,
          mode: "commit",
          response_format: "pcm",
          sample_rate: QWEN_REALTIME_SAMPLE_RATE_HZ,
          language_type: input.language === "zh-CN" ? "Chinese" : "English",
        },
      });
      sendRealtimeEvent(socket, {
        type: "input_text_buffer.append",
        text: input.text,
      });
      sendRealtimeEvent(socket, { type: "input_text_buffer.commit" });
    });

    socket.on("message", (payload) => {
      try {
        const event = JSON.parse(toMessageText(payload)) as {
          type?: string;
          delta?: string;
          error?: { message?: string };
          message?: string;
        };
        if (event.type === "response.audio.delta" && event.delta) {
          chunks.push(Buffer.from(event.delta, "base64"));
        } else if (event.type === "response.done") {
          resolveOnce();
        } else if (event.type === "error" || event.type === "response.error") {
          rejectOnce(new Error(event.error?.message ?? event.message ?? "Qwen realtime TTS failed."));
        }
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.on("error", (error) => {
      rejectOnce(error instanceof Error ? error : new Error(String(error)));
    });

    socket.on("close", () => {
      if (!settled) {
        rejectOnce(new Error("Qwen realtime TTS socket closed before response.done."));
      }
    });
  });
}

function sendRealtimeEvent(socket: QwenRealtimeWebSocketLike, event: Record<string, unknown>) {
  socket.send(JSON.stringify({ event_id: `event_${randomUUID().replace(/-/g, "")}`, ...event }));
}

function buildRealtimeWebSocketUrl(baseUrl: string, model: string) {
  const wsBase = baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return `${wsBase}/api-ws/v1/realtime?model=${encodeURIComponent(model)}`;
}

function toMessageText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf8");
  if (payload instanceof ArrayBuffer) return Buffer.from(payload).toString("utf8");
  if (Array.isArray(payload)) return Buffer.concat(payload).toString("utf8");
  return String(payload);
}
