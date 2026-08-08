import {
  createDeepSeekTextClient,
  deepSeekTimeoutErrorMessage,
} from "@/lib/ai/providers/deepseek-client";
import {
  createQwenMultimodalClient,
  type QwenMultimodalContent,
} from "@/lib/ai/providers/qwen-client";
import { getProviderForRole } from "@/lib/ai/providers/registry";
import {
  runLearningGuideMultiAgentGraph,
  type LearningGuideAgentCompletionInput,
  type LearningGuideAgentId,
  type LearningGuideGraphResult,
} from "@/lib/ai/orchestration/learning-guide-graph";
import {
  authorizeLearningAiGuideCourseAccess,
  createLearningAiGuideAccessDeniedResponse,
  createLearningAiGuideCourseContextRequiredAccessDecision,
} from "@/lib/server/learning-ai-guide-access";
import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-store";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
import type { Locale } from "@/i18n/copy";
import type {
  DeepSeekCompleteInput,
  DeepSeekCompleteResult,
} from "@/lib/ai/providers/deepseek-client";
import type {
  QwenMultimodalCompleteInput,
  QwenMultimodalCompleteResult,
} from "@/lib/ai/providers/qwen-client";

export const dynamic = "force-dynamic";

type LearningAiGuideAgentId = LearningGuideAgentId;

type LearningAiGuideAgent = {
  id: LearningAiGuideAgentId;
  providerRole: "text-reasoning" | "multimodal";
  label: Record<Locale, string>;
  systemPrompt: Record<Locale, string>;
};

type LearningAiGuideRequestBody = {
  agentId: LearningAiGuideAgentId;
  mode: "single-agent" | "multi-agent";
  locale: Locale;
  question: string;
  course?: {
    courseId?: string;
    courseTitle?: string;
  };
  slide?: {
    slideNumber?: number;
    slideTitle?: string;
    narrationText?: string;
    imageUrl?: string;
  };
};

type DeepSeekTextClient = {
  complete(input: DeepSeekCompleteInput): Promise<DeepSeekCompleteResult>;
};

type QwenMultimodalClient = {
  complete(input: QwenMultimodalCompleteInput): Promise<QwenMultimodalCompleteResult>;
};

type LearningAiGuidePostHandlerDeps = {
  env?: Record<string, string | undefined>;
  createDeepSeekTextClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => DeepSeekTextClient;
  createQwenMultimodalClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => QwenMultimodalClient;
  fetch?: typeof fetch;
};

const learningAiGuideAgents: Record<LearningAiGuideAgentId, LearningAiGuideAgent> = {
  "learning-advisor": {
    id: "learning-advisor",
    providerRole: "text-reasoning",
    label: {
      "zh-CN": "学习顾问",
      "en-US": "Study Advisor",
    },
    systemPrompt: {
      "zh-CN":
        "你是 UAIS 学习顾问。请用简洁中文帮助学生规划学习路径、拆解任务、指出下一步行动。不要编造课程外事实。",
      "en-US":
        "You are the UAIS study advisor. Help the learner plan study paths, break down tasks, and choose next actions. Do not invent facts outside the course context.",
    },
  },
  "concept-explainer": {
    id: "concept-explainer",
    providerRole: "multimodal",
    label: {
      "zh-CN": "概念解读",
      "en-US": "Concept Explainer",
    },
    systemPrompt: {
      "zh-CN":
        "你是 UAIS 概念解读助理。请结合当前 PPT 文本和可用图片，解释核心概念、误区和例子。回答要适合大学课堂学习。",
      "en-US":
        "You are the UAIS concept explainer. Use the current slide text and any available image to explain concepts, misconceptions, and examples for university learning.",
    },
  },
  "code-assistant": {
    id: "code-assistant",
    providerRole: "text-reasoning",
    label: {
      "zh-CN": "代码助手",
      "en-US": "Code Assistant",
    },
    systemPrompt: {
      "zh-CN":
        "你是 UAIS 代码助手。请把算法、公式或课堂概念转成清晰步骤、伪代码或短代码示例。避免无关工程扩展。",
      "en-US":
        "You are the UAIS code assistant. Turn algorithms, formulas, or class concepts into clear steps, pseudocode, or short code examples. Avoid unrelated engineering expansion.",
    },
  },
};

const learningGuideMultiAgentMaxTokens = 256;

export const POST = createLearningAiGuidePostHandler();

export function createLearningAiGuidePostHandler(
  deps: LearningAiGuidePostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const deepSeekFactory = deps.createDeepSeekTextClient ?? createDeepSeekTextClient;
  const qwenFactory = deps.createQwenMultimodalClient ?? createQwenMultimodalClient;

  return async function POST(request: Request) {
    const traceId = readSafeLearningAiGuideTraceId(request);
    try {
      const appSession = getUaisAppSessionUserFromCookieString(
        request.headers.get("cookie"),
        { env },
      );
      if (!appSession) {
        throw new PublicLearningAiGuideError(
          "UAIS app session is required for learning AI guide.",
          401,
        );
      }

      const body = parseLearningAiGuideRequest(await request.json());
      const courseId = body.course?.courseId;
      if (!courseId) {
        const access = createLearningAiGuideCourseContextRequiredAccessDecision({
          appSession,
        });
        return createLearningAiGuideAccessDeniedResponse({ access, traceId });
      }

      const access = await authorizeLearningAiGuideCourseAccess({
        appSession,
        env,
        fetch: deps.fetch,
        courseId,
      });
      if (access.status === "denied") {
        return createLearningAiGuideAccessDeniedResponse({ access, traceId });
      }

      if (body.mode === "multi-agent") {
        const completeAgent = createLearningGuideMultiAgentCompleter({
          env,
          deepSeekFactory,
          qwenFactory,
        });
        const graphResult = await runLearningGuideMultiAgentGraph({
          locale: body.locale,
          question: body.question,
          courseTitle: body.course?.courseTitle ?? "UAIS course",
          slideTitle: body.slide?.slideTitle ?? "current slide",
          slideNumber: body.slide?.slideNumber,
          narrationText: body.slide?.narrationText,
          slideImageUrl: body.slide?.imageUrl,
          actor: createLearningGuideGraphActor(appSession),
          env,
          completeAgent,
        });

        return Response.json(createLearningAiGuideMultiAgentResponse(graphResult));
      }

      const agent = learningAiGuideAgents[body.agentId];
      const provider = getProviderForRole(agent.providerRole);
      const context = createLearningGuideContext(body);

      if (agent.providerRole === "multimodal") {
        const apiKey = env.DASHSCOPE_API_KEY;
        if (!apiKey) {
          throw new PublicLearningAiGuideError(
            "DASHSCOPE_API_KEY is required for learning multimodal AI guide.",
            503,
          );
        }
        const client = qwenFactory({
          apiKey,
          baseUrl: env.DASHSCOPE_BASE_URL,
        });
        const content = createQwenUserContent(context, body.slide?.imageUrl);
        const completion = await client.complete({
          model: env.QWEN_MULTIMODAL_MODEL ?? provider.defaultModel,
          messages: [
            { role: "system", content: agent.systemPrompt[body.locale] },
            { role: "user", content },
          ],
        });

        return Response.json(
          createLearningAiGuideResponse({
            content: completion.content,
            agent,
            provider: {
              provider: "qwen",
              role: "multimodal",
              model: completion.model,
            },
          }),
        );
      }

      const apiKey = env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new PublicLearningAiGuideError(
          "DEEPSEEK_API_KEY is required for learning text AI guide.",
          503,
        );
      }
      const client = deepSeekFactory({
        apiKey,
        baseUrl: env.DEEPSEEK_BASE_URL,
      });
      const completion = await client.complete({
        model: env.DEEPSEEK_MODEL ?? provider.defaultModel,
        messages: [
          { role: "system", content: agent.systemPrompt[body.locale] },
          { role: "user", content: context },
        ],
      });

      return Response.json(
        createLearningAiGuideResponse({
          content: completion.content,
          agent,
          provider: {
            provider: "deepseek",
            role: "text-reasoning",
            model: completion.model,
          },
        }),
      );
    } catch (error) {
      const publicError = createPublicLearningAiGuideError(error);
      const status = publicError?.status ?? 400;
      const message = publicError?.message ?? "Learning AI guide request failed.";
      return Response.json(
        {
          error: message,
          redaction: createLearningAiGuideRedaction(),
        },
        { status },
      );
    }
  };
}

function createPublicLearningAiGuideError(error: unknown) {
  if (error instanceof PublicLearningAiGuideError) {
    return error;
  }
  if (error instanceof TeachingCourseManagementStoreError) {
    return new PublicLearningAiGuideError(error.message, error.status);
  }
  if (error instanceof Error && error.message === deepSeekTimeoutErrorMessage) {
    // A provider timeout is an upstream failure, not a bad request.
    return new PublicLearningAiGuideError(error.message, 504);
  }
  if (
    error instanceof Error &&
    (error.message ===
      "UAIS LangGraph production runtime requires external persistence; configure a GCS-backed checkpointer/store or an external LangGraph runtime persistence adapter." ||
      error.message ===
        "UAIS LangGraph external persistence requires injected checkpointer and store adapters.")
  ) {
    return new PublicLearningAiGuideError(error.message, 503);
  }
  return undefined;
}

function readSafeLearningAiGuideTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-learning-ai-guide-${crypto.randomUUID()}`;
}

function createLearningAiGuideResponse(input: {
  content: string;
  agent: LearningAiGuideAgent;
  provider: {
    provider: "deepseek" | "qwen";
    role: "text-reasoning" | "multimodal";
    model: string;
  };
}) {
  return {
    status: "ok",
    message: {
      id: `learning-ai-${input.agent.id}`,
      kind: "assistant",
      agentId: input.agent.id,
      text: input.content,
    },
    provider: input.provider,
    progress: [
      {
        responsibleSession: "S07",
        progressText: `S07 routed ${input.agent.id} through ${input.provider.provider} ${input.provider.role}.`,
      },
      {
        responsibleSession: "S19",
        progressText: "S19 provider credentials stayed server-side and redacted.",
      },
    ],
    redaction: createLearningAiGuideRedaction(),
  };
}

function createLearningAiGuideMultiAgentResponse(graphResult: LearningGuideGraphResult) {
  return {
    status: "ok",
    message: {
      id: "learning-ai-langgraph-multi-agent",
      kind: "assistant",
      agentId: "multi-agent",
      text: graphResult.messageText,
    },
    orchestration: graphResult,
    progress: [
      ...graphResult.progress,
      {
        responsibleSession: "S07",
        progressText:
          "S07 ran the learning guide through LangGraph with live provider calls inside each agent node.",
      },
    ],
    redaction: createLearningAiGuideRedaction(),
  };
}

function createLearningGuideMultiAgentCompleter(input: {
  env: Record<string, string | undefined>;
  deepSeekFactory: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => DeepSeekTextClient;
  qwenFactory: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => QwenMultimodalClient;
}) {
  const deepSeekApiKey = input.env.DEEPSEEK_API_KEY;
  if (!deepSeekApiKey) {
    throw new PublicLearningAiGuideError(
      "DEEPSEEK_API_KEY is required for learning multi-agent AI guide.",
      503,
    );
  }
  const dashscopeApiKey = input.env.DASHSCOPE_API_KEY;
  if (!dashscopeApiKey) {
    throw new PublicLearningAiGuideError(
      "DASHSCOPE_API_KEY is required for learning multi-agent AI guide.",
      503,
    );
  }

  const deepSeekProvider = getProviderForRole("text-reasoning");
  const qwenProvider = getProviderForRole("multimodal");
  const deepSeekClient = input.deepSeekFactory({
    apiKey: deepSeekApiKey,
    baseUrl: input.env.DEEPSEEK_BASE_URL,
  });
  const qwenClient = input.qwenFactory({
    apiKey: dashscopeApiKey,
    baseUrl: input.env.DASHSCOPE_BASE_URL,
  });

  return async function completeLearningGuideAgent(call: LearningGuideAgentCompletionInput) {
    const context = createLearningGuideGraphContext(call);
    const agent = learningAiGuideAgents[call.agent.id];
    if (call.agent.providerRole === "multimodal") {
      const completion = await qwenClient.complete({
        model: input.env.QWEN_MULTIMODAL_MODEL ?? qwenProvider.defaultModel,
        maxTokens: learningGuideMultiAgentMaxTokens,
        enableThinking: false,
        messages: [
          { role: "system", content: agent.systemPrompt[call.locale] },
          { role: "user", content: createQwenUserContent(context, call.slideImageUrl) },
        ],
      });

      return {
        provider: "qwen" as const,
        role: "multimodal" as const,
        model: completion.model,
        content: completion.content,
      };
    }

    const completion = await deepSeekClient.complete({
      model: input.env.DEEPSEEK_MODEL ?? deepSeekProvider.defaultModel,
      maxTokens: learningGuideMultiAgentMaxTokens,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: agent.systemPrompt[call.locale] },
        { role: "user", content: context },
      ],
    });

    return {
      provider: "deepseek" as const,
      role: "text-reasoning" as const,
      model: completion.model,
      content: completion.content,
    };
  };
}

function createLearningGuideGraphActor(appSession: {
  account: string;
  role: "teacher" | "student" | "admin";
}) {
  let role: "admin" | "educator" | "learner";
  if (appSession.role === "teacher") {
    role = "educator";
  } else if (appSession.role === "student") {
    role = "learner";
  } else {
    role = "admin";
  }
  return {
    actorId: `app-session-${role}-${toSafeActorIdSegment(appSession.account)}`,
    role,
  } as const;
}

function parseLearningAiGuideRequest(value: unknown): LearningAiGuideRequestBody {
  if (!isRecord(value)) {
    throw new PublicLearningAiGuideError("Request body must be an object.", 400);
  }

  const agentId = readString(value.agentId);
  if (!isLearningAiGuideAgentId(agentId)) {
    throw new PublicLearningAiGuideError("Learning AI guide agentId is invalid.", 400);
  }

  const question = readString(value.question);
  if (!question || question.length > 1200) {
    throw new PublicLearningAiGuideError(
      "Learning AI guide question must be 1-1200 characters.",
      400,
    );
  }

  const locale = value.locale === "en-US" ? "en-US" : "zh-CN";
  const mode = value.mode === "multi-agent" ? "multi-agent" : "single-agent";

  return {
    agentId,
    mode,
    locale,
    question,
    course: parseCourse(value.course),
    slide: parseSlide(value.slide),
  };
}

function parseCourse(value: unknown): LearningAiGuideRequestBody["course"] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    courseId: readString(value.courseId),
    courseTitle: readString(value.courseTitle),
  };
}

function parseSlide(value: unknown): LearningAiGuideRequestBody["slide"] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    slideNumber: typeof value.slideNumber === "number" ? value.slideNumber : undefined,
    slideTitle: readString(value.slideTitle),
    narrationText: readString(value.narrationText),
    imageUrl: readString(value.imageUrl),
  };
}

function createLearningGuideContext(body: LearningAiGuideRequestBody) {
  const courseTitle = body.course?.courseTitle ?? "UAIS course";
  const courseId = body.course?.courseId ?? "unknown-course";
  const slideNumber = body.slide?.slideNumber
    ? String(body.slide.slideNumber)
    : "unknown";
  const slideTitle = body.slide?.slideTitle ?? "current slide";
  const narrationText = body.slide?.narrationText ?? "No narration text provided.";
  const imageStatus = getSafeExternalImageUrl(body.slide?.imageUrl)
    ? "external image attached"
    : "no external image attachment";

  return [
    `Course ID: ${courseId}`,
    `Course title: ${courseTitle}`,
    `Slide number: ${slideNumber}`,
    `Slide title: ${slideTitle}`,
    `Narration/context: ${narrationText}`,
    `Image context: ${imageStatus}`,
    `Learner question: ${body.question}`,
  ].join("\n");
}

function createLearningGuideGraphContext(call: LearningGuideAgentCompletionInput) {
  const slideNumber = call.slideNumber ? String(call.slideNumber) : "unknown";
  const narrationText = call.narrationText ?? "No narration text provided.";
  const imageStatus = getSafeExternalImageUrl(call.slideImageUrl)
    ? "external image attached"
    : "no external image attachment";
  const previousTurns =
    call.previousTurns.length > 0
      ? [
          "Previous agent turns:",
          ...call.previousTurns.map(
            (turn) => `${turn.label} (${turn.provider.provider}/${turn.provider.model}): ${turn.content}`,
          ),
        ]
      : ["Previous agent turns: none"];

  return [
    `Agent: ${call.agent.id}`,
    `Agent role: ${call.agent.providerRole}`,
    `Course title: ${call.courseTitle}`,
    `Slide number: ${slideNumber}`,
    `Slide title: ${call.slideTitle}`,
    `Narration/context: ${narrationText}`,
    `Image context: ${imageStatus}`,
    `Learner question: ${call.question}`,
    ...previousTurns,
  ].join("\n");
}

function createQwenUserContent(
  context: string,
  imageUrl: string | undefined,
): QwenMultimodalContent {
  const safeImageUrl = getSafeExternalImageUrl(imageUrl);
  if (!safeImageUrl) {
    return [{ type: "text", text: context }];
  }

  return [
    { type: "text", text: context },
    { type: "image_url", image_url: { url: safeImageUrl } },
  ];
}

function getSafeExternalImageUrl(imageUrl: string | undefined) {
  if (!imageUrl) {
    return undefined;
  }

  if (imageUrl.startsWith("https://") || imageUrl.startsWith("data:image/")) {
    return imageUrl;
  }

  return undefined;
}

function toSafeActorIdSegment(value: string) {
  const safeSegment = value.trim().replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 72);
  return safeSegment || "unknown";
}

function isLearningAiGuideAgentId(value: string): value is LearningAiGuideAgentId {
  return value === "learning-advisor" || value === "concept-explainer" || value === "code-assistant";
}

function createLearningAiGuideRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

class PublicLearningAiGuideError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicLearningAiGuideError";
    this.status = status;
  }
}
