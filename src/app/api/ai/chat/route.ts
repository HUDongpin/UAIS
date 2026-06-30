import { runAgentLoop } from "@/lib/ai/orchestration/agent-loop";
import type {
  UaisAgentConfig,
  UaisChatMessage,
  UaisOrchestrationEvent,
  UaisProviderRole,
} from "@/lib/ai/orchestration/types";
import {
  createDeepSeekTextClient,
  type DeepSeekCompleteResult,
} from "@/lib/ai/providers/deepseek-client";
import { assertLiveProviderApproval } from "@/lib/ai/providers/live-approval";
import { createLiveProviderAuditEvent } from "@/lib/ai/providers/provider-audit";
import { assertResponsibleProgressIsDisplaySafe } from "@/lib/ai/progress/responsible-progress";
import { getProviderForRole } from "@/lib/ai/providers/registry";
import {
  assertUaisAiAccess,
  createUaisAiAccessDeniedResponse,
  isUaisAiAccessDeniedError,
} from "@/lib/server/ai-access-control";

export const dynamic = "force-dynamic";

type ChatRequestBody = {
  executionMode?: "contract" | "live";
  liveProviderApproved?: boolean;
  courseId?: string;
  agents: UaisAgentConfig[];
  messages: UaisChatMessage[];
  maxAgentTurns?: number;
};

type DeepSeekTextClient = {
  complete(input: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    model?: string;
  }): Promise<DeepSeekCompleteResult>;
};

type ChatPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  createDeepSeekTextClient?: (options: {
    apiKey: string;
    baseUrl?: string;
  }) => DeepSeekTextClient;
};

export const POST = createChatPostHandler();

export function createChatPostHandler(deps: ChatPostHandlerDeps = {}) {
  const env = deps.env ?? process.env;
  const deepSeekClientFactory = deps.createDeepSeekTextClient ?? createDeepSeekTextClient;

  return async function POST(request: Request) {
    try {
      authorizeChatRequestBeforeBodyRead({
        request,
        env,
      });
      const rawBody = await request.json();
      authorizeContractChatRequestBeforeValidation({
        request,
        value: rawBody,
        env,
      });
      const body = parseChatRequest(rawBody);
      if (body.executionMode === "live") {
        assertLiveProviderApproval({
          request,
          env,
          liveProviderApproved: body.liveProviderApproved,
        });
      }
      assertUaisAiAccess({
        request,
        action: "live-chat",
        resource: {
          courseId: body.courseId,
        },
        env,
        requireSignedSession: true,
      });

      const result = await runAgentLoop({
        agents: body.agents,
        messages: body.messages,
        maxAgentTurns: body.maxAgentTurns ?? 4,
        respond: async (agent) => {
          if (body.executionMode === "live" && agent.providerRole === "text-reasoning") {
            const apiKey = env.DEEPSEEK_API_KEY;
            if (!apiKey) {
              throw new Error("DEEPSEEK_API_KEY is required for live text reasoning.");
            }
            const provider = getProviderForRole("text-reasoning");
            const client = deepSeekClientFactory({
              apiKey,
              baseUrl: env.DEEPSEEK_BASE_URL,
            });
            const completion = await client.complete({
              model: env.DEEPSEEK_MODEL ?? provider.defaultModel,
              messages: body.messages.map((message) => ({
                role:
                  message.role === "student"
                    ? "user"
                    : message.role === "agent"
                      ? "assistant"
                      : "system",
                content: message.content,
              })),
            });

            return {
              agentId: agent.id,
              content: completion.content,
              actions: [],
            };
          }

          return {
            agentId: agent.id,
            content: `${agent.name} 已通过 UAIS multi-agent contract 响应。`,
            actions: [],
          };
        },
      });

      return Response.json({
        status: result.status,
        turns: result.turns.map((turn) => {
          const agent = body.agents.find((candidate) => candidate.id === turn.agentId);
          const provider = getProviderForRole(agent?.providerRole ?? "text-reasoning");
          return {
            ...turn,
            provider: {
              role: provider.role,
              provider: provider.provider,
              defaultModel: provider.defaultModel,
            },
          };
        }),
        events: result.events,
        progress: createChatProgress(result.events),
        orchestration: {
          trace: result.trace,
          runtime: result.runtime,
          runtimeEvents: result.runtimeEvents,
        },
        ...(body.executionMode === "live"
          ? {
              auditEvent: createLiveProviderAuditEvent({
                provider: "deepseek",
                providerRole: "text-reasoning",
                action: "chat-completion",
                subject: {
                  agentId: result.turns[0]?.agentId,
                },
              }),
            }
          : {}),
      });
    } catch (error) {
      if (isUaisAiAccessDeniedError(error)) {
        return createUaisAiAccessDeniedResponse(error);
      }
      return Response.json(
        {
          error: createPublicChatErrorMessage(error),
        },
        { status: 400 },
      );
    }
  };
}

function authorizeChatRequestBeforeBodyRead(input: {
  request: Request;
  env: Record<string, string | undefined>;
}) {
  assertUaisAiAccess({
    request: input.request,
    action: "live-chat",
    env: input.env,
    requireSignedSession: true,
  });
}

function authorizeContractChatRequestBeforeValidation(input: {
  request: Request;
  value: unknown;
  env: Record<string, string | undefined>;
}) {
  const executionMode = isRecord(input.value) ? input.value.executionMode : undefined;
  if (executionMode === "live") {
    return;
  }

  assertUaisAiAccess({
    request: input.request,
    action: "live-chat",
    resource: {
      courseId: isRecord(input.value) && typeof input.value.courseId === "string"
        ? input.value.courseId
        : undefined,
    },
    env: input.env,
    requireSignedSession: true,
  });
}

function createPublicChatErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Invalid AI chat request.";
  }
  if (error.message === "UAIS LangGraph runtime event contains non-display-safe data.") {
    return "Progress item contains non-display-safe data.";
  }
  return error.message;
}

function createChatProgress(events: UaisOrchestrationEvent[]) {
  return assertResponsibleProgressIsDisplaySafe(
    events.map((event, index) => ({
      id: `progress-${index + 1}`,
      type: event.type,
      responsibleSession: event.responsibleSession,
      ...(event.responsibleAgent ? { responsibleAgent: event.responsibleAgent } : {}),
      progressText: event.progressText,
    })),
  );
}

function parseChatRequest(value: unknown): ChatRequestBody {
  if (!isRecord(value)) {
    throw new Error("Request body must be an object.");
  }

  if (!Array.isArray(value.agents) || value.agents.length === 0) {
    throw new Error("At least one agent is required.");
  }

  if (!Array.isArray(value.messages)) {
    throw new Error("Messages must be an array.");
  }

  const agents = assertUniqueAgentRoster(value.agents.map(parseAgent));
  const messages = value.messages.map(parseMessage);
  const maxAgentTurns =
    typeof value.maxAgentTurns === "number" && value.maxAgentTurns > 0
      ? Math.floor(value.maxAgentTurns)
      : undefined;

  const executionMode =
    value.executionMode === "live" || value.executionMode === "contract"
      ? value.executionMode
      : "contract";

  return {
    executionMode,
    liveProviderApproved: value.liveProviderApproved === true,
    courseId: typeof value.courseId === "string" ? value.courseId : undefined,
    agents,
    messages,
    maxAgentTurns,
  };
}

function parseAgent(value: unknown): UaisAgentConfig {
  if (!isRecord(value)) {
    throw new Error("Agent must be an object.");
  }

  const providerRole = readString(value.providerRole);
  if (!isProviderRole(providerRole)) {
    throw new Error("Agent providerRole is invalid.");
  }

  return {
    id: requireString(value.id, "Agent id is required."),
    handle: requireString(value.handle, "Agent handle is required."),
    name: requireString(value.name, "Agent name is required."),
    role: parseAgentRole(readString(value.role)),
    providerRole,
    priority: typeof value.priority === "number" ? value.priority : 0,
    allowedActions: Array.isArray(value.allowedActions)
      ? value.allowedActions.filter((action): action is string => typeof action === "string")
      : [],
  };
}

function assertUniqueAgentRoster(agents: UaisAgentConfig[]) {
  const agentIds = new Set<string>();
  const agentHandles = new Set<string>();

  for (const agent of agents) {
    const id = agent.id.trim();
    const handle = agent.handle.trim();

    if (agentIds.has(id)) {
      throw new Error("UAIS multi-agent roster has duplicate agent ids.");
    }
    if (agentHandles.has(handle)) {
      throw new Error("UAIS multi-agent roster has duplicate agent handles.");
    }

    agentIds.add(id);
    agentHandles.add(handle);
  }

  return agents;
}

function parseMessage(value: unknown): UaisChatMessage {
  if (!isRecord(value)) {
    throw new Error("Message must be an object.");
  }

  const role = readString(value.role);
  if (role !== "student" && role !== "agent" && role !== "system") {
    throw new Error("Message role is invalid.");
  }

  return {
    id: requireString(value.id, "Message id is required."),
    role,
    content: requireString(value.content, "Message content is required."),
    agentId: typeof value.agentId === "string" ? value.agentId : undefined,
  };
}

function parseAgentRole(value: string | undefined): UaisAgentConfig["role"] {
  if (value === "teacher" || value === "assistant" || value === "student" || value === "specialist") {
    return value;
  }
  throw new Error("Agent role is invalid.");
}

function isProviderRole(value: string | undefined): value is UaisProviderRole {
  return (
    value === "text-reasoning" ||
    value === "multimodal" ||
    value === "image-generation" ||
    value === "voice-clone" ||
    value === "ppt-narration"
  );
}

function requireString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
