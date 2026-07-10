import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Locale } from "@/i18n/copy";
import type { UaisProviderRole } from "@/lib/ai/orchestration/types";
import {
  createUaisLangGraphRuntime,
  type UaisLangGraphActor,
  type UaisLangGraphPersistenceStatus,
  type UaisLangGraphRuntimeEvent,
  type UaisLangGraphRunResult,
} from "@/lib/ai/langgraph-runtime/runtime";

export type LearningGuideAgentId =
  | "learning-advisor"
  | "concept-explainer"
  | "code-assistant";

export type LearningGuideGraphTurn = {
  agentId: LearningGuideAgentId;
  label: string;
  providerRole: UaisProviderRole;
  provider: {
    provider: "deepseek" | "qwen";
    role: UaisProviderRole;
    model: string;
  };
  content: string;
  actions: string[];
};

export type LearningGuideGraphAgent = {
  id: LearningGuideAgentId;
  handle: string;
  name: Record<Locale, string>;
  providerRole: UaisProviderRole;
};

export type LearningGuideAgentCompletionInput = {
  agent: LearningGuideGraphAgent;
  locale: Locale;
  question: string;
  courseTitle: string;
  slideTitle: string;
  slideNumber?: number;
  narrationText?: string;
  slideImageUrl?: string;
  previousTurns: LearningGuideGraphTurn[];
};

export type LearningGuideAgentCompletion = {
  provider: "deepseek" | "qwen";
  role: UaisProviderRole;
  model: string;
  content: string;
};

export type LearningGuideGraphInput = {
  locale: Locale;
  question: string;
  courseTitle: string;
  slideTitle: string;
  slideNumber?: number;
  narrationText?: string;
  slideImageUrl?: string;
  threadId?: string;
  actor?: UaisLangGraphActor;
  env?: Record<string, string | undefined>;
  runtime?: ReturnType<typeof createUaisLangGraphRuntime>;
  persistence?: UaisLangGraphPersistenceStatus;
  completeAgent?: (
    input: LearningGuideAgentCompletionInput,
  ) => Promise<LearningGuideAgentCompletion>;
};

export type LearningGuideGraphResult = {
  status: "ok";
  graph: {
    runtime: "langgraph";
    graphId: "learning-ai-guide";
    topologicalOrder: LearningGuideAgentId[];
  };
  turns: LearningGuideGraphTurn[];
  messageText: string;
  progress: Array<{
    responsibleSession: "S07";
    responsibleAgent: {
      id: LearningGuideAgentId;
      handle: string;
      name: string;
      providerRole: UaisProviderRole;
    };
    progressText: string;
  }>;
  runtime: {
    engine: "uais-langgraph-production-runtime";
    status: "completed";
    threadId: string;
    eventCount: number;
    redaction: {
      secrets: "omitted";
      localFiles: "omitted";
      assets: "ids-only";
    };
  };
  trace: LearningGuideGraphTrace;
  runtimeEvents: UaisLangGraphRuntimeEvent[];
};

export type LearningGuideGraphTrace = {
  handoffs: Array<{
    fromNodeId: string;
    toNodeId: string;
    reason: "start-sequence" | "advisor-context" | "concept-grounded";
  }>;
  memory: {
    mode: "thread-checkpoint" | "external-checkpoint";
    threadId: string;
    store: string;
  };
  humanInTheLoop: {
    status: "ready";
    resumeMode: "teacher-or-learner-review";
  };
};

type LearningGuideGraphState = Pick<
  LearningGuideGraphInput,
  "locale" | "question" | "courseTitle" | "slideTitle" | "slideNumber" | "narrationText"
> & {
  slideImageUrl?: string;
  turns: LearningGuideGraphTurn[];
};

const learningGuideGraphId = "learning-ai-guide" as const;

const learningGuideAgents = [
  {
    id: "learning-advisor",
    handle: "@学习顾问",
    name: {
      "zh-CN": "学习顾问",
      "en-US": "Study Advisor",
    },
    providerRole: "text-reasoning",
  },
  {
    id: "concept-explainer",
    handle: "@概念解读",
    name: {
      "zh-CN": "概念解读",
      "en-US": "Concept Explainer",
    },
    providerRole: "multimodal",
  },
  {
    id: "code-assistant",
    handle: "@代码助手",
    name: {
      "zh-CN": "代码助手",
      "en-US": "Code Assistant",
    },
    providerRole: "text-reasoning",
  },
] satisfies LearningGuideGraphAgent[];

const LearningGuideState = Annotation.Root({
  locale: Annotation<Locale>(),
  question: Annotation<string>(),
  courseTitle: Annotation<string>(),
  slideTitle: Annotation<string>(),
  slideNumber: Annotation<number | undefined>(),
  narrationText: Annotation<string | undefined>(),
  slideImageUrl: Annotation<string | undefined>(),
  turns: Annotation<LearningGuideGraphTurn[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

export async function runLearningGuideMultiAgentGraph(
  input: LearningGuideGraphInput,
): Promise<LearningGuideGraphResult> {
  if (!input.completeAgent) {
    throw new Error("Learning guide multi-agent graph requires live provider adapters.");
  }
  const completeAgent = input.completeAgent;
  const runtime =
    input.runtime ??
    createUaisLangGraphRuntime({
      env: input.env,
      persistence: input.persistence,
    });
  const compiledGraph = new StateGraph(LearningGuideState)
    .addNode("learning-advisor", (state) =>
      createTurnUpdate("learning-advisor", state, completeAgent),
    )
    .addNode("concept-explainer", (state) =>
      createTurnUpdate("concept-explainer", state, completeAgent),
    )
    .addNode("code-assistant", (state) =>
      createTurnUpdate("code-assistant", state, completeAgent),
    )
    .addEdge(START, "learning-advisor")
    .addEdge("learning-advisor", "concept-explainer")
    .addEdge("concept-explainer", "code-assistant")
    .addEdge("code-assistant", END)
    .compile(runtime.createCompileOptions());

  const graphInput: LearningGuideGraphState = {
    locale: input.locale,
    question: input.question,
    courseTitle: input.courseTitle,
    slideTitle: input.slideTitle,
    slideNumber: input.slideNumber,
    narrationText: input.narrationText,
    slideImageUrl: input.slideImageUrl,
    turns: [],
  };
  const threadId = input.threadId ?? createLearningGuideThreadId(input);
  const runtimeResult = await runtime.run<LearningGuideGraphState, LearningGuideGraphState>({
    graph: compiledGraph,
    graphId: learningGuideGraphId,
    threadId,
    actor: input.actor ?? {
      actorId: "learning-guide-learner",
      role: "learner",
    },
    input: graphInput,
  });
  const state = requireCompletedLearningGuideRuntime(runtimeResult);
  const turns = state.turns;

  return {
    status: "ok",
    graph: {
      runtime: "langgraph",
      graphId: learningGuideGraphId,
      topologicalOrder: learningGuideAgents.map((agent) => agent.id),
    },
    turns,
    messageText: formatMultiAgentMessage(input.locale, turns),
    progress: turns.map((turn) => {
      const agent = getLearningGuideAgent(turn.agentId);
      return {
        responsibleSession: "S07",
        responsibleAgent: {
          id: agent.id,
          handle: agent.handle,
          name: agent.name[input.locale],
          providerRole: agent.providerRole,
        },
        progressText: `S07 LangGraph learning guide completed ${agent.handle} ${agent.name[input.locale]} for ${agent.providerRole}.`,
      };
    }),
    runtime: {
      engine: "uais-langgraph-production-runtime",
      status: "completed",
      threadId,
      eventCount: runtimeResult.events.length,
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    },
    trace: createLearningGuideGraphTrace({
      threadId,
      persistence: runtime.getPersistenceStatus(),
    }),
    runtimeEvents: runtimeResult.events,
  };
}

function requireCompletedLearningGuideRuntime(
  result: UaisLangGraphRunResult<LearningGuideGraphState>,
) {
  if (result.status !== "completed") {
    throw new Error("Learning guide LangGraph runtime unexpectedly interrupted.");
  }
  return result.output;
}

async function createTurnUpdate(
  agentId: LearningGuideAgentId,
  state: typeof LearningGuideState.State,
  completeAgent: (
    input: LearningGuideAgentCompletionInput,
  ) => Promise<LearningGuideAgentCompletion>,
) {
  const agent = getLearningGuideAgent(agentId);
  const completion = requireLearningGuideCompletion(
    agent,
    await completeAgent({
      agent,
      locale: state.locale,
      question: state.question,
      courseTitle: state.courseTitle,
      slideTitle: state.slideTitle,
      slideNumber: state.slideNumber,
      narrationText: state.narrationText,
      slideImageUrl: state.slideImageUrl,
      previousTurns: state.turns,
    }),
  );

  return {
    turns: [
      {
        agentId,
        label: agent.name[state.locale],
        providerRole: agent.providerRole,
        provider: {
          provider: completion.provider,
          role: completion.role,
          model: completion.model,
        },
        content: completion.content,
        actions: ["respond"],
      },
    ],
  };
}

function formatMultiAgentMessage(locale: Locale, turns: LearningGuideGraphTurn[]) {
  if (locale === "en-US") {
    return [
      "LangGraph multi-agent guide completed:",
      ...turns.map((turn, index) => `${index + 1}. ${turn.label}: ${turn.content}`),
    ].join("\n");
  }

  return [
    "LangGraph 多智能体导学已完成：",
    ...turns.map((turn, index) => `${index + 1}. ${turn.label}：${turn.content}`),
  ].join("\n");
}

function getLearningGuideAgent(agentId: LearningGuideAgentId) {
  return learningGuideAgents.find((agent) => agent.id === agentId) ?? learningGuideAgents[0];
}

function createLearningGuideGraphTrace(input: {
  threadId: string;
  persistence: UaisLangGraphPersistenceStatus;
}): LearningGuideGraphTrace {
  return {
    handoffs: [
      {
        fromNodeId: "learning-guide-supervisor",
        toNodeId: "learning-advisor",
        reason: "start-sequence",
      },
      {
        fromNodeId: "learning-advisor",
        toNodeId: "concept-explainer",
        reason: "advisor-context",
      },
      {
        fromNodeId: "concept-explainer",
        toNodeId: "code-assistant",
        reason: "concept-grounded",
      },
    ],
    memory: {
      mode: input.persistence.mode === "external" ? "external-checkpoint" : "thread-checkpoint",
      threadId: input.threadId,
      store: input.persistence.store,
    },
    humanInTheLoop: {
      status: "ready",
      resumeMode: "teacher-or-learner-review",
    },
  };
}

function requireLearningGuideCompletion(
  agent: LearningGuideGraphAgent,
  completion: LearningGuideAgentCompletion,
) {
  if (completion.role !== agent.providerRole) {
    throw new Error("Learning guide provider role mismatch.");
  }
  if (!completion.model.trim() || !completion.content.trim()) {
    throw new Error("Learning guide provider returned an empty completion.");
  }
  if (agent.providerRole === "multimodal" && completion.provider !== "qwen") {
    throw new Error("Learning guide multimodal agent must run through Qwen.");
  }
  if (agent.providerRole === "text-reasoning" && completion.provider !== "deepseek") {
    throw new Error("Learning guide text agent must run through DeepSeek.");
  }
  return completion;
}

function createLearningGuideThreadId(input: LearningGuideGraphInput) {
  // The multi-agent guide always runs START->END without resuming, so each
  // invocation needs a unique, actor-scoped thread. Deriving the thread from
  // request content alone made different learners asking the same question about
  // the same slide share one production checkpoint, causing cross-learner turn
  // accumulation and content leakage.
  const actorSegment = toSafeLearningGuideThreadSegment(input.actor?.actorId ?? "learner");
  return `learning-guide-${actorSegment}-${createLearningGuideThreadNonce()}`;
}

function toSafeLearningGuideThreadSegment(value: string) {
  const segment = value
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 48);
  return segment || "learner";
}

function createLearningGuideThreadNonce() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid.replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
