import { describe, expect, it } from "vitest";
import { createDeepSeekTextClient } from "@/lib/ai/providers/deepseek-client";
import {
  createQwenImageClient,
  createQwenMultimodalClient,
  createQwenVoiceClient,
  type QwenRealtimeWebSocketLike,
} from "@/lib/ai/providers/qwen-client";
import { QWEN_REALTIME_VOICE_CLONE_MODEL } from "@/lib/ai/voice/ppt-narration";

describe("UAIS provider clients", () => {
  it("calls DeepSeek with OpenAI-compatible chat completions and redacts the result", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createDeepSeekTextClient({
      apiKey: "secret-deepseek",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          choices: [{ message: { content: "DeepSeek response" } }],
          usage: { total_tokens: 12 },
        });
      },
    });

    const result = await client.complete({
      messages: [{ role: "user", content: "变量怎么定？" }],
      maxTokens: 256,
      thinking: { type: "disabled" },
    } as Parameters<typeof client.complete>[0] & {
      maxTokens: number;
      thinking: { type: "disabled" };
    });
    const requestBody = JSON.parse(String(requests[0].init.body));

    expect(result).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      content: "DeepSeek response",
      usage: { totalTokens: 12 },
    });
    expect(requests[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[0].init.method).toBe("POST");
    expect(requestBody.model).toBe("deepseek-v4-flash");
    expect(requestBody.max_tokens).toBe(256);
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(JSON.stringify(result)).not.toContain("secret-qwen");
  });

  it("streams Qwen Omni chat through DashScope compatible mode", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createQwenMultimodalClient({
      apiKey: "secret-qwen",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(
          [
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "Qwen multimodal " } }],
            })}`,
            `data: ${JSON.stringify({
              choices: [{ delta: { content: "response" } }],
            })}`,
            `data: ${JSON.stringify({
              choices: [],
              usage: { total_tokens: 9 },
            })}`,
            "data: [DONE]",
          ].join("\n\n"),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });

    const result = await client.complete({
      messages: [
        { role: "system", content: "Explain the slide." },
        {
          role: "user",
          content: [
            { type: "text", text: "What does this diagram show?" },
            {
              type: "image_url",
              image_url: { url: "https://www.uais.top/learning/slide.png" },
            },
          ],
        },
      ],
      maxTokens: 256,
      enableThinking: false,
    } as Parameters<typeof client.complete>[0] & {
      maxTokens: number;
      enableThinking: boolean;
    });
    const requestBody = JSON.parse(String(requests[0].init.body));

    expect(result).toEqual({
      provider: "qwen",
      providerRole: "multimodal",
      model: "qwen3.5-omni-plus",
      content: "Qwen multimodal response",
      usage: { totalTokens: 9 },
    });
    expect(requests[0].url).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    expect(requests[0].init.method).toBe("POST");
    expect(requestBody.model).toBe("qwen3.5-omni-plus");
    expect(requestBody.max_tokens).toBe(256);
    expect(requestBody.enable_thinking).toBe(false);
    expect(requestBody.stream).toBe(true);
    expect(requestBody.stream_options).toEqual({ include_usage: true });
    expect(requestBody.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://www.uais.top/learning/slide.png" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-qwen");
  });

  it("keeps non-Omni Qwen compatible chat on the JSON response path", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createQwenMultimodalClient({
      apiKey: "secret-qwen",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          choices: [{ message: { content: "Qwen VL response" } }],
          usage: { total_tokens: 7 },
        });
      },
    });

    const result = await client.complete({
      model: "qwen-vl-plus",
      messages: [{ role: "user", content: "Describe this image." }],
    });
    const requestBody = JSON.parse(String(requests[0].init.body));

    expect(requestBody.stream).toBe(false);
    expect(requestBody).not.toHaveProperty("stream_options");
    expect(result).toMatchObject({
      provider: "qwen",
      model: "qwen-vl-plus",
      content: "Qwen VL response",
      usage: { totalTokens: 7 },
    });
  });

  it("generates a Qwen course cover through the official multimodal image API", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createQwenImageClient({
      apiKey: "secret-qwen",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          output: {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: [
                    {
                      image:
                        "https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/course-cover.png?Expires=24h",
                    },
                  ],
                },
              },
            ],
          },
          usage: {
            width: 800,
            height: 480,
            image_count: 1,
          },
          request_id: "request-image-1",
        });
      },
    });

    const result = await client.generateCourseCover({
      courseName: "AI支持的初等数学研究",
      instructor: "康霞",
      unit: "广州大学 (404)",
      department: "实验教学中心",
      semester: "2025-2026第二学期",
      description: "面向师范生的研究方法课程。",
    });

    const requestBody = JSON.parse(String(requests[0].init.body));

    expect(result).toEqual({
      provider: "qwen",
      providerRole: "image-generation",
      model: "qwen-image-2.0",
      imageUrl:
        "https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/course-cover.png?Expires=24h",
      requestId: "request-image-1",
      usage: {
        width: 800,
        height: 480,
        imageCount: 1,
      },
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "generated-url-only",
      },
    });
    expect(requests[0].url).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
    expect(requests[0].init.method).toBe("POST");
    expect(requestBody.model).toBe("qwen-image-2.0");
    expect(requestBody.parameters).toMatchObject({
      size: "800*480",
      prompt_extend: true,
      watermark: false,
    });
    expect(requestBody.input.messages[0].content[0].text).toContain("AI支持的初等数学研究");
    expect(requestBody.input.messages[0].content[0].text).toContain("university course cover");
    expect(JSON.stringify(result)).not.toContain("secret-qwen");
  });

  it("submits Qwen voice enrollment through the official DashScope customization API", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createQwenVoiceClient({
      apiKey: "secret-qwen",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          output: { voice: "voice-qwen-redacted", target_model: QWEN_REALTIME_VOICE_CLONE_MODEL },
          request_id: "request-1",
        });
      },
    });

    const result = await client.submitVoiceClone({
      teacherId: "teacher-kang",
      sampleAssetId: "asset-voice-10s",
      sampleDurationSeconds: 10,
      targetVoiceLabel: "Kang teacher PPT voice",
      preferredVoiceName: "kangxia_ppt_0616",
      sampleAudioDataUrl: "data:audio/mp4;base64,ZmFrZS1hdWRpbw==",
      sampleText: "康霞博士授权阿里千问克隆本段教师声音。",
      languageHint: "zh",
    });

    expect(result).toEqual({
      provider: "qwen",
      taskId: "voice-qwen-redacted",
      requestId: "request-1",
      status: "submitted",
      clonedVoiceId: "voice-qwen-redacted",
      targetModel: QWEN_REALTIME_VOICE_CLONE_MODEL,
    });
    expect(requests[0].url).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization");
    expect(requests[0].init.method).toBe("POST");
    expect(JSON.stringify(requests[0].init.body)).toContain("qwen-voice-enrollment");
    expect(JSON.stringify(requests[0].init.body)).toContain(QWEN_REALTIME_VOICE_CLONE_MODEL);
    expect(JSON.stringify(requests[0].init.body)).toContain("kangxia_ppt_0616");
    expect(JSON.stringify(requests[0].init.body)).toContain("data:audio/mp4;base64,ZmFrZS1hdWRpbw==");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("synthesizes Qwen PPT narration with realtime WebSocket segments", async () => {
    const sockets: FakeRealtimeSocket[] = [];
    const client = createQwenVoiceClient({
      apiKey: "secret-qwen",
      WebSocketCtor: class extends FakeRealtimeSocket {
        constructor(url: string, protocolsOrOptions?: unknown) {
          super(url, protocolsOrOptions);
          sockets.push(this);
        }
      },
    });

    const result = await client.submitPptNarration({
      courseId: "research-methods",
      pptAssetId: "unit-3",
      clonedVoiceId: "voice-qwen-redacted",
      language: "zh-CN",
      slideScripts: [{ slideId: "s1", narrationText: "今天我们学习研究问题。" }],
    });

    expect(result.taskId).toBe("audio-manifest-research-methods-unit-3");
    expect(result.targetModel).toBe(QWEN_REALTIME_VOICE_CLONE_MODEL);
    expect(result.audioManifest.segments).toHaveLength(1);
    expect(result.audioSegments[0]).toEqual({
      slideId: "s1",
      audioId: "tts_unit-3_s1",
      audioBase64: Buffer.from("fake-pcm").toString("base64"),
      byteLength: 8,
      format: "pcm",
      sampleRateHz: 24000,
    });
    expect(sockets[0].url).toBe(
      `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${QWEN_REALTIME_VOICE_CLONE_MODEL}`,
    );
    expect(sockets[0].options).toEqual({
      headers: {
        Authorization: "Bearer secret-qwen",
      },
    });
    expect(sockets[0].sent.map((message) => message.type)).toEqual([
      "session.update",
      "input_text_buffer.append",
      "input_text_buffer.commit",
      "session.finish",
    ]);
    expect(sockets[0].sent[0].session).toEqual({
      voice: "voice-qwen-redacted",
      mode: "commit",
      response_format: "pcm",
      sample_rate: 24000,
      language_type: "Chinese",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("queries Qwen voice clone task status without exposing the API key", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createQwenVoiceClient({
      apiKey: "secret-qwen",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          output: {
            task_status: "SUCCEEDED",
            cloned_voice_id: "voice-qwen-redacted",
          },
          request_id: "request-status-1",
        });
      },
    });

    const result = await client.getVoiceCloneTaskStatus("task-voice-1");

    expect(result).toEqual({
      provider: "qwen",
      providerTaskId: "task-voice-1",
      providerStatus: "SUCCEEDED",
      clonedVoiceId: "voice-qwen-redacted",
      requestId: "request-status-1",
    });
    expect(requests[0].url).toBe("https://dashscope.aliyuncs.com/api/v1/tasks/task-voice-1");
    expect(requests[0].init.method).toBe("GET");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("deletes a Qwen cloned voice through the DashScope customization API without returning the private voice id", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createQwenVoiceClient({
      apiKey: "secret-qwen",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          output: { voice: "voice-qwen-private" },
          request_id: "request-delete-1",
        });
      },
    });

    const result = await client.revokeClonedVoice("voice-qwen-private");

    expect(result).toEqual({
      provider: "qwen",
      providerRole: "voice-clone",
      status: "revoked",
      requestId: "request-delete-1",
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
    expect(requests[0].url).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization");
    expect(requests[0].init.method).toBe("POST");
    expect(requests[0].init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-qwen",
    });
    expect(JSON.parse(String(requests[0].init.body))).toEqual({
      model: "qwen-voice-enrollment",
      input: {
        action: "delete",
        voice: "voice-qwen-private",
      },
    });
    expect(JSON.stringify(result)).not.toContain("voice-qwen-private");
    expect(JSON.stringify(result)).not.toContain("secret-qwen");
  });
});

class FakeRealtimeSocket implements QwenRealtimeWebSocketLike {
  readonly sent: Array<Record<string, unknown>> = [];
  private listeners: Record<string, Array<(event?: unknown) => void>> = {};

  constructor(
    readonly url: string,
    readonly options?: unknown,
  ) {
    queueMicrotask(() => this.emit("open"));
  }

  on(event: string, listener: (event?: unknown) => void) {
    this.listeners[event] = [...(this.listeners[event] ?? []), listener];
    return this;
  }

  send(data: string) {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    if (message.type === "input_text_buffer.commit") {
      queueMicrotask(() => {
        this.emit("message", JSON.stringify({
          type: "response.audio.delta",
          delta: Buffer.from("fake-pcm").toString("base64"),
        }));
        this.emit("message", JSON.stringify({ type: "response.done" }));
      });
    }
  }

  close() {
    this.emit("close");
  }

  private emit(event: string, payload?: unknown) {
    for (const listener of this.listeners[event] ?? []) {
      listener(payload);
    }
  }
}
