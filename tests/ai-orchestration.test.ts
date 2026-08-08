import { describe, expect, it } from "vitest";
import { runAgentLoop, selectNextAgent } from "@/lib/ai/orchestration/agent-loop";
import { runLearningGuideMultiAgentGraph } from "@/lib/ai/orchestration/learning-guide-graph";
import {
  createUaisLangGraphMemoryCheckpointer,
  createUaisLangGraphRuntime,
} from "@/lib/ai/langgraph-runtime/runtime";
import type { UaisAgentConfig, UaisChatMessage } from "@/lib/ai/orchestration/types";

const agents: UaisAgentConfig[] = [
  {
    id: "teacher",
    handle: "@教师",
    name: "教师",
    role: "teacher",
    providerRole: "text-reasoning",
    priority: 10,
    allowedActions: ["respond"],
  },
  {
    id: "methods",
    handle: "@方法顾问",
    name: "方法顾问",
    role: "assistant",
    providerRole: "text-reasoning",
    priority: 7,
    allowedActions: ["respond"],
  },
];

describe("UAIS multi-agent orchestration", () => {
  it("routes an explicit mention to the matching agent", () => {
    const messages: UaisChatMessage[] = [
      { id: "m1", role: "student", content: "变量怎么定？@方法顾问" },
    ];

    expect(selectNextAgent({ agents, messages, previousTurns: [] })).toEqual({
      type: "agent",
      agentId: "methods",
      reason: "explicit-mention",
    });
  });

  it("routes every mentioned agent in mention order before cueing the learner", () => {
    const messages: UaisChatMessage[] = [
      {
        id: "m1",
        role: "student",
        content: "@方法顾问 数据怎么收集？@教师 课堂怎么安排？",
      },
    ];

    expect(selectNextAgent({ agents, messages, previousTurns: [] })).toEqual({
      type: "agent",
      agentId: "methods",
      reason: "explicit-mention",
    });
    expect(
      selectNextAgent({
        agents,
        messages,
        previousTurns: [{ agentId: "methods", content: "方法顾问 response", actions: [] }],
      }),
    ).toEqual({
      type: "agent",
      agentId: "teacher",
      reason: "explicit-mention",
    });
    expect(
      selectNextAgent({
        agents,
        messages,
        previousTurns: [
          { agentId: "methods", content: "方法顾问 response", actions: [] },
          { agentId: "teacher", content: "教师 response", actions: [] },
        ],
      }),
    ).toEqual({
      type: "cue-user",
      reason: "agent-answered",
    });
  });

  it("resolves alias mentions and keeps mention order independent of roster order", () => {
    const aliasAgents: UaisAgentConfig[] = [
      { ...agents[0], aliases: ["@Teacher"] },
      { ...agents[1], aliases: ["@MethodsAdvisor"] },
    ];
    const messages: UaisChatMessage[] = [
      {
        id: "m1",
        role: "student",
        content: "@MethodsAdvisor how do we collect data? @Teacher what about class time?",
      },
    ];

    expect(selectNextAgent({ agents: aliasAgents, messages, previousTurns: [] })).toEqual({
      type: "agent",
      agentId: "methods",
      reason: "explicit-mention",
    });
    expect(
      selectNextAgent({
        agents: aliasAgents,
        messages,
        previousTurns: [{ agentId: "methods", content: "Methods response", actions: [] }],
      }),
    ).toEqual({
      type: "agent",
      agentId: "teacher",
      reason: "explicit-mention",
    });
  });

  it("keeps an unmentioned fallback agent to a single turn", () => {
    const messages: UaisChatMessage[] = [
      { id: "m1", role: "student", content: "请帮我规划研究设计" },
    ];

    expect(selectNextAgent({ agents, messages, previousTurns: [] })).toEqual({
      type: "agent",
      agentId: "teacher",
      reason: "priority",
    });
    expect(
      selectNextAgent({
        agents,
        messages,
        previousTurns: [{ agentId: "teacher", content: "教师 response", actions: [] }],
      }),
    ).toEqual({
      type: "cue-user",
      reason: "agent-answered",
    });
  });

  it("runs one loop turn per mentioned agent", async () => {
    const result = await runAgentLoop({
      agents,
      messages: [
        {
          id: "m1",
          role: "student",
          content: "@方法顾问 数据怎么收集？@教师 课堂怎么安排？",
        },
      ],
      maxAgentTurns: 4,
      respond: async (agent) => ({
        agentId: agent.id,
        content: `${agent.name} response`,
        actions: [],
      }),
    });

    expect(result.status).toBe("cue-user");
    expect(result.turns.map((turn) => turn.agentId)).toEqual(["methods", "teacher"]);
  });

  it("runs a bounded director-agent loop until the user is cued", async () => {
    const result = await runAgentLoop({
      agents,
      messages: [{ id: "m1", role: "student", content: "请帮我规划研究设计" }],
      maxAgentTurns: 2,
      respond: async (agent) => ({
        agentId: agent.id,
        content: `${agent.name} response`,
        actions: [],
      }),
    });

    expect(result.status).toBe("cue-user");
    expect(result.turns).toHaveLength(1);
    expect(result.events.map((event) => event.type)).toEqual([
      "agent-start",
      "agent-end",
      "cue-user",
    ]);
    expect(
      (result as {
        runtime?: {
          engine: string;
          graphId: string;
          eventCount: number;
        };
      }).runtime,
    ).toEqual(
      expect.objectContaining({
        engine: "uais-langgraph-production-runtime",
        graphId: "agent-loop-director",
        eventCount: 3,
      }),
    );
    expect(
      (result as {
        runtimeEvents?: Array<{
          nodeId?: string;
          actor: {
            actorId: string;
            role: string;
          };
        }>;
      }).runtimeEvents?.[0],
    ).toMatchObject({
      nodeId: "supervisor",
      actor: {
        actorId: "agent-loop-learner",
        role: "learner",
      },
    });
  });

  it("runs chat agents as first-class LangGraph nodes instead of hiding them inside one director node", async () => {
    const result = await runAgentLoop({
      agents,
      messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
      maxAgentTurns: 2,
      respond: async (agent) => ({
        agentId: agent.id,
        content: `${agent.name} response`,
        actions: ["respond"],
      }),
    });

    expect(result.runtime.eventCount).toBeGreaterThan(1);
    expect(result.runtimeEvents.map((event) => event.nodeId)).toEqual([
      "supervisor",
      "agent-methods",
      "supervisor",
    ]);
    expect(JSON.stringify(result.runtimeEvents)).not.toContain("director-loop");
    expect(result.trace).toEqual(
      expect.objectContaining({
        runtime: "langgraph",
        graphId: "agent-loop-director",
        supervisorNodeId: "supervisor",
        agentNodeIds: expect.arrayContaining([
          {
            agentId: "methods",
            nodeId: "agent-methods",
            handle: "@方法顾问",
            name: "方法顾问",
            providerRole: "text-reasoning",
          },
        ]),
        handoffs: expect.arrayContaining([
          expect.objectContaining({
            fromNodeId: "supervisor",
            toNodeId: "agent-methods",
            reason: "explicit-mention",
          }),
          expect.objectContaining({
            fromNodeId: "agent-methods",
            toNodeId: "supervisor",
            reason: "agent-answered",
          }),
          expect.objectContaining({
            fromNodeId: "supervisor",
            toNodeId: "learner",
            reason: "agent-answered",
          }),
        ]),
      }),
    );
  });

  it("emits auditable progress text that names the responsible agent and provider role", async () => {
    const result = await runAgentLoop({
      agents,
      messages: [{ id: "m1", role: "student", content: "变量怎么定？@方法顾问" }],
      maxAgentTurns: 2,
      respond: async (agent) => ({
        agentId: agent.id,
        content: `${agent.name} response`,
        actions: ["respond"],
      }),
    });

    const progressText = result.events.map((event) => event.progressText);

    expect(progressText).toEqual([
      "S07 multi-agent director assigned @方法顾问 方法顾问 for text-reasoning.",
      "S07 multi-agent director completed @方法顾问 方法顾问 for text-reasoning.",
      "S07 multi-agent director returned control to the learner after @方法顾问 方法顾问.",
    ]);
    expect(result.events[0]).toMatchObject({
      responsibleSession: "S07",
      responsibleAgent: {
        id: "methods",
        handle: "@方法顾问",
        name: "方法顾问",
        providerRole: "text-reasoning",
      },
    });
  });

  it("runs the learning guide through a LangGraph multi-agent graph", async () => {
    const result = await runLearningGuideMultiAgentGraph({
      locale: "zh-CN",
      question: "把这页整理成 3 个学习要点",
      courseTitle: "初等数学研究",
      slideNumber: 1,
      slideTitle: "自然数的序数理论",
      narrationText: "今天我们进入自然数的序数理论。",
      completeAgent: async ({ agent }) => ({
        provider: agent.providerRole === "multimodal" ? "qwen" : "deepseek",
        role: agent.providerRole,
        model: `${agent.id}-fixture-model`,
        content: `${agent.name["zh-CN"]} live fixture`,
      }),
    });

    expect(result.graph).toEqual({
      runtime: "langgraph",
      graphId: "learning-ai-guide",
      topologicalOrder: ["learning-advisor", "concept-explainer", "code-assistant"],
    });
    expect(result.turns.map((turn) => turn.agentId)).toEqual([
      "learning-advisor",
      "concept-explainer",
      "code-assistant",
    ]);
    expect(result.turns.map((turn) => turn.provider)).toEqual([
      {
        provider: "deepseek",
        role: "text-reasoning",
        model: "learning-advisor-fixture-model",
      },
      {
        provider: "qwen",
        role: "multimodal",
        model: "concept-explainer-fixture-model",
      },
      {
        provider: "deepseek",
        role: "text-reasoning",
        model: "code-assistant-fixture-model",
      },
    ]);
    expect(result.messageText).toContain("学习顾问 live fixture");
    expect(result.messageText).toContain("LangGraph 多智能体导学已完成");
    expect(result.progress[0].progressText).toContain("S07 LangGraph learning guide completed");
  });

  it("isolates multi-agent guide threads per learner even when persistence is shared", async () => {
    // A single runtime/checkpointer reused across two runs models the shared
    // production external checkpointer that is keyed by thread id.
    const runtime = createUaisLangGraphRuntime({
      checkpointer: createUaisLangGraphMemoryCheckpointer(),
    });
    const sharedRequest = {
      locale: "en-US" as const,
      question: "What is variance?",
      courseTitle: "Research Methods",
      slideTitle: "Slide 1",
      runtime,
    };

    const learnerA = await runLearningGuideMultiAgentGraph({
      ...sharedRequest,
      actor: { actorId: "learner-A", role: "learner" },
      completeAgent: async ({ agent }) => ({
        provider: agent.providerRole === "multimodal" ? "qwen" : "deepseek",
        role: agent.providerRole,
        model: `${agent.id}-model`,
        content: "fixture",
      }),
    });
    const learnerB = await runLearningGuideMultiAgentGraph({
      ...sharedRequest,
      actor: { actorId: "learner-B", role: "learner" },
      completeAgent: async ({ agent }) => ({
        provider: agent.providerRole === "multimodal" ? "qwen" : "deepseek",
        role: agent.providerRole,
        model: `${agent.id}-model`,
        content: "fixture",
      }),
    });

    // Each learner sees exactly their own three turns; no cross-learner bleed.
    expect(learnerA.turns).toHaveLength(3);
    expect(learnerB.turns).toHaveLength(3);
    expect(learnerA.runtime.threadId).not.toBe(learnerB.runtime.threadId);
  });

  it("gives each agent-loop invocation a unique, actor-scoped thread id", async () => {
    const messages: UaisChatMessage[] = [
      { id: "m1", role: "student", content: "same question" },
    ];
    const respond = async (agent: UaisAgentConfig) => ({
      agentId: agent.id,
      content: `${agent.name} response`,
      actions: [],
    });

    const first = await runAgentLoop({
      agents,
      messages,
      maxAgentTurns: 2,
      actor: { actorId: "learner-A", role: "learner" },
      respond,
    });
    const second = await runAgentLoop({
      agents,
      messages,
      maxAgentTurns: 2,
      actor: { actorId: "learner-A", role: "learner" },
      respond,
    });
    const otherActor = await runAgentLoop({
      agents,
      messages,
      maxAgentTurns: 2,
      actor: { actorId: "learner-B", role: "learner" },
      respond,
    });

    // Identical messages no longer collapse to one shared thread (the production
    // turn-accumulation / max-turns short-circuit bug).
    expect(first.runtime.threadId).not.toBe(second.runtime.threadId);
    // Threads are namespaced per actor.
    expect(first.runtime.threadId.startsWith("agent-loop-learner-A-")).toBe(true);
    expect(otherActor.runtime.threadId.startsWith("agent-loop-learner-B-")).toBe(true);
    // Each invocation returns exactly its own turn, with no accumulation.
    expect(first.turns).toHaveLength(1);
    expect(second.turns).toHaveLength(1);
  });

  it("runs the learning guide through the UAIS production runtime foundation", async () => {
    const result = await runLearningGuideMultiAgentGraph({
      locale: "zh-CN",
      question: "把这页整理成 3 个学习要点",
      courseTitle: "初等数学研究",
      slideNumber: 1,
      slideTitle: "自然数的序数理论",
      narrationText: "今天我们进入自然数的序数理论。",
      threadId: "thread-learning-guide-production-001",
      actor: {
        actorId: "learner-001",
        role: "learner",
      },
      completeAgent: async ({ agent }) => ({
        provider: agent.providerRole === "multimodal" ? "qwen" : "deepseek",
        role: agent.providerRole,
        model: `${agent.id}-fixture-model`,
        content: `${agent.name["zh-CN"]} live fixture`,
      }),
    });

    expect(result.runtime).toEqual(
      expect.objectContaining({
        engine: "uais-langgraph-production-runtime",
        status: "completed",
        threadId: "thread-learning-guide-production-001",
        eventCount: 3,
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    );
    expect(result.runtimeEvents.map((event) => event.nodeId)).toEqual([
      "learning-advisor",
      "concept-explainer",
      "code-assistant",
    ]);
    expect(JSON.stringify(result.runtimeEvents)).not.toContain("DASHSCOPE_API_KEY=");
    expect(JSON.stringify(result.runtimeEvents)).not.toContain("/Users/");
  });
});
