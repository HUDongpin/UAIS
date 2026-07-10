import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { selectNextAgent } from "./director";
import type {
  UaisAgentConfig,
  UaisAgentLoopStatus,
  UaisAgentTurn,
  UaisChatMessage,
  UaisDirectorDecision,
  UaisOrchestrationEvent,
  UaisResponsibleAgent,
} from "./types";
import {
  createUaisLangGraphRuntime,
  type UaisLangGraphActor,
  type UaisLangGraphRuntimeEvent,
  type UaisLangGraphRunResult,
} from "@/lib/ai/langgraph-runtime/runtime";

export { selectNextAgent };

const RESPONSIBLE_ORCHESTRATION_SESSION = "S07";

export type RunAgentLoopInput = {
  agents: UaisAgentConfig[];
  messages: UaisChatMessage[];
  maxAgentTurns: number;
  threadId?: string;
  actor?: UaisLangGraphActor;
  env?: Record<string, string | undefined>;
  respond: (agent: UaisAgentConfig, context: { turns: UaisAgentTurn[] }) => Promise<UaisAgentTurn>;
};

export type RunAgentLoopResult = {
  status: UaisAgentLoopStatus;
  turns: UaisAgentTurn[];
  events: UaisOrchestrationEvent[];
  trace: UaisAgentLoopTrace;
  runtime: {
    engine: "uais-langgraph-production-runtime";
    graphId: "agent-loop-director";
    status: "completed";
    threadId: string;
    eventCount: number;
    redaction: {
      secrets: "omitted";
      localFiles: "omitted";
      assets: "ids-only";
    };
  };
  runtimeEvents: UaisLangGraphRuntimeEvent[];
};

export type UaisAgentLoopTrace = {
  runtime: "langgraph";
  graphId: "agent-loop-director";
  supervisorNodeId: "supervisor";
  agentNodeIds: UaisAgentLoopTraceAgentNode[];
  handoffs: UaisAgentLoopHandoff[];
};

type UaisAgentLoopTraceAgentNode = {
  agentId: string;
  nodeId: string;
  handle: string;
  name: string;
  providerRole: UaisAgentConfig["providerRole"];
};

type UaisAgentLoopHandoff = {
  fromNodeId: string;
  toNodeId: string;
  reason: UaisDirectorDecision["reason"] | "agent-answered" | "agent-not-found";
  agentId?: string;
};

type AgentLoopGraphState = {
  status?: UaisAgentLoopStatus;
  turns: UaisAgentTurn[];
  events: UaisOrchestrationEvent[];
  nextNodeId?: string;
  handoffs: UaisAgentLoopHandoff[];
};

const agentLoopGraphId = "agent-loop-director" as const;

const AgentLoopState = Annotation.Root({
  status: Annotation<UaisAgentLoopStatus | undefined>(),
  turns: Annotation<UaisAgentTurn[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  events: Annotation<UaisOrchestrationEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  nextNodeId: Annotation<string | undefined>(),
  handoffs: Annotation<UaisAgentLoopHandoff[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

export async function runAgentLoop({
  agents,
  messages,
  maxAgentTurns,
  threadId,
  actor,
  env,
  respond,
}: RunAgentLoopInput): Promise<RunAgentLoopResult> {
  const runtime = createUaisLangGraphRuntime({
    env,
  });
  const agentNodeIds = createAgentNodeIds(agents);
  let graph: StateGraph<
    typeof AgentLoopState,
    typeof AgentLoopState.State,
    Partial<AgentLoopGraphState>,
    string
  > = new StateGraph(AgentLoopState);
  graph = graph.addNode("supervisor", (state) =>
    runSupervisorNode({
      agents,
      agentNodeIds,
      messages,
      maxAgentTurns,
      state,
    }),
  );

  for (const agent of agents) {
    const nodeId = agentNodeIds.get(agent.id);
    if (!nodeId) {
      continue;
    }
    graph = graph.addNode(nodeId, (state) =>
      runAgentNode({
        agent,
        nodeId,
        respond,
        state,
      }),
    );
  }

  graph = graph.addEdge(START, "supervisor");
  const supervisorPathMap: Record<string, string> = {
    end: END,
  };
  for (const nodeId of agentNodeIds.values()) {
    graph = graph.addEdge(nodeId, "supervisor");
    supervisorPathMap[nodeId] = nodeId;
  }

  const compiledGraph = graph
    .addConditionalEdges(
      "supervisor",
      (state) => (state.status ? "end" : state.nextNodeId ?? "end"),
      supervisorPathMap,
    )
    .compile(runtime.createCompileOptions());
  const effectiveActor = actor ?? {
    actorId: "agent-loop-learner",
    role: "learner" as const,
  };
  const safeThreadId = threadId ?? createAgentLoopThreadId(effectiveActor.actorId);
  const runtimeResult = await runtime.run<AgentLoopGraphState, AgentLoopGraphState>({
    graph: compiledGraph,
    graphId: agentLoopGraphId,
    threadId: safeThreadId,
    actor: effectiveActor,
    input: {
      turns: [],
      events: [],
      handoffs: [],
    },
  });
  const state = requireCompletedAgentLoopRuntime(runtimeResult);

  return {
    status: state.status ?? "end",
    turns: state.turns,
    events: state.events,
    trace: {
      runtime: "langgraph",
      graphId: agentLoopGraphId,
      supervisorNodeId: "supervisor",
      agentNodeIds: agents.map((agent) => ({
        agentId: agent.id,
        nodeId: agentNodeIds.get(agent.id) ?? createAgentNodeId(agent.id),
        handle: agent.handle,
        name: agent.name,
        providerRole: agent.providerRole,
      })),
      handoffs: state.handoffs,
    },
    runtime: {
      engine: "uais-langgraph-production-runtime",
      graphId: agentLoopGraphId,
      status: "completed",
      threadId: safeThreadId,
      eventCount: runtimeResult.events.length,
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    },
    runtimeEvents: runtimeResult.events,
  };
}

function runSupervisorNode({
  agents,
  agentNodeIds,
  messages,
  maxAgentTurns,
  state,
}: Pick<RunAgentLoopInput, "agents" | "messages" | "maxAgentTurns"> & {
  agentNodeIds: Map<string, string>;
  state: typeof AgentLoopState.State;
}): Partial<AgentLoopGraphState> {
  const turns = state.turns;
  if (turns.length >= maxAgentTurns) {
    return {
      status: "max-turns",
      nextNodeId: undefined,
      events: [
        {
          type: "end",
          reason: "max-turns",
          ...createProgressAudit({
            action: "end",
            reason: "max-turns",
          }),
        },
      ],
    };
  }

  const decision = selectNextAgent({ agents, messages, previousTurns: turns });

  if (decision.type === "cue-user") {
    const fromAgent = findAgentForTurn(agents, turns.at(-1));
    return {
      status: "cue-user",
      nextNodeId: undefined,
      events: [
        {
          type: "cue-user",
          fromAgentId: turns.at(-1)?.agentId,
          ...createProgressAudit({
            action: "cue-user",
            agent: fromAgent,
          }),
        },
      ],
      handoffs: [
        {
          fromNodeId: "supervisor",
          toNodeId: "learner",
          reason: decision.reason,
          ...(turns.at(-1)?.agentId ? { agentId: turns.at(-1)?.agentId } : {}),
        },
      ],
    };
  }

  if (decision.type === "end") {
    return {
      status: "end",
      nextNodeId: undefined,
      events: [
        {
          type: "end",
          reason: decision.reason,
          ...createProgressAudit({
            action: "end",
            reason: decision.reason,
          }),
        },
      ],
    };
  }

  const agent = agents.find((candidate) => candidate.id === decision.agentId);
  if (!agent) {
    return {
      status: "end",
      nextNodeId: undefined,
      events: [
        {
          type: "end",
          reason: "agent-not-found",
          ...createProgressAudit({
            action: "end",
            reason: "agent-not-found",
          }),
        },
      ],
      handoffs: [
        {
          fromNodeId: "supervisor",
          toNodeId: "learner",
          reason: "agent-not-found",
          agentId: decision.agentId,
        },
      ],
    };
  }

  const nextNodeId = agentNodeIds.get(agent.id) ?? createAgentNodeId(agent.id);
  return {
    nextNodeId,
    events: [
      {
        type: "agent-start",
        agentId: agent.id,
        ...createProgressAudit({
          action: "assigned",
          agent,
        }),
      },
    ],
    handoffs: [
      {
        fromNodeId: "supervisor",
        toNodeId: nextNodeId,
        reason: decision.reason,
        agentId: agent.id,
      },
    ],
  };
}

async function runAgentNode({
  agent,
  nodeId,
  respond,
  state,
}: Pick<RunAgentLoopInput, "respond"> & {
  agent: UaisAgentConfig;
  nodeId: string;
  state: typeof AgentLoopState.State;
}): Promise<Partial<AgentLoopGraphState>> {
  const turn = await respond(agent, { turns: [...state.turns] });
  const turnAgent = findAgentForTurn([agent], turn) ?? agent;

  return {
    turns: [turn],
    events: [
      {
        type: "agent-end",
        agentId: turn.agentId,
        content: turn.content,
        actions: turn.actions,
        ...createProgressAudit({
          action: "completed",
          agent: turnAgent,
        }),
      },
    ],
    handoffs: [
      {
        fromNodeId: nodeId,
        toNodeId: "supervisor",
        reason: "agent-answered",
        agentId: turn.agentId,
      },
    ],
  };
}

function requireCompletedAgentLoopRuntime(
  result: UaisLangGraphRunResult<AgentLoopGraphState>,
) {
  if (result.status !== "completed") {
    throw new Error("UAIS agent loop LangGraph runtime unexpectedly interrupted.");
  }
  return result.output;
}

function createAgentLoopThreadId(actorId: string) {
  // The agent loop runs to completion (cue-user/end/max-turns) without resuming,
  // so each invocation needs a unique, actor-scoped thread. Deriving the thread
  // from message content made retries and different actors sharing the same
  // messages collide on one production checkpoint, accumulating turns (and
  // tripping the max-turns short-circuit so no fresh response was returned).
  const actorSegment = toSafeAgentLoopThreadSegment(actorId);
  return `agent-loop-${actorSegment}-${createAgentLoopThreadNonce()}`;
}

function toSafeAgentLoopThreadSegment(value: string) {
  const segment = value
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 48);
  return segment || "learner";
}

function createAgentLoopThreadNonce() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid.replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function hashThreadSeed(seed: string) {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function createAgentNodeIds(agents: UaisAgentConfig[]) {
  const nodeIds = new Map<string, string>();
  const used = new Set<string>();
  for (const agent of agents) {
    let nodeId = createAgentNodeId(agent.id);
    if (used.has(nodeId)) {
      nodeId = `${nodeId}-${hashThreadSeed(agent.handle).slice(0, 6)}`;
    }
    used.add(nodeId);
    nodeIds.set(agent.id, nodeId);
  }
  return nodeIds;
}

function createAgentNodeId(agentId: string) {
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/.test(agentId)) {
    return `agent-${agentId}`;
  }
  return `agent-${hashThreadSeed(agentId)}`;
}

function findAgentForTurn(agents: UaisAgentConfig[], turn?: UaisAgentTurn) {
  return turn ? agents.find((agent) => agent.id === turn.agentId) : undefined;
}

function createProgressAudit(input:
  | {
      action: "assigned" | "completed";
      agent: UaisAgentConfig;
    }
  | {
      action: "cue-user";
      agent?: UaisAgentConfig;
    }
  | {
      action: "end";
      reason: string;
    }): {
  responsibleSession: "S07";
  progressText: string;
  responsibleAgent?: UaisResponsibleAgent;
} {
  switch (input.action) {
    case "assigned":
    case "completed":
      return {
        responsibleSession: RESPONSIBLE_ORCHESTRATION_SESSION,
        responsibleAgent: createResponsibleAgent(input.agent),
        progressText: `S07 multi-agent director ${input.action} ${formatAgentLabel(
          input.agent,
        )} for ${input.agent.providerRole}.`,
      };
    case "cue-user":
      return {
        responsibleSession: RESPONSIBLE_ORCHESTRATION_SESSION,
        ...(input.agent ? { responsibleAgent: createResponsibleAgent(input.agent) } : {}),
        progressText: input.agent
          ? `S07 multi-agent director returned control to the learner after ${formatAgentLabel(
              input.agent,
            )}.`
          : "S07 multi-agent director returned control to the learner.",
      };
    case "end":
      return {
        responsibleSession: RESPONSIBLE_ORCHESTRATION_SESSION,
        progressText: `S07 multi-agent director ended the loop: ${input.reason}.`,
      };
  }
}

function createResponsibleAgent(agent: UaisAgentConfig): UaisResponsibleAgent {
  return {
    id: agent.id,
    handle: agent.handle,
    name: agent.name,
    providerRole: agent.providerRole,
  };
}

function formatAgentLabel(agent: UaisAgentConfig) {
  return `${agent.handle} ${agent.name}`;
}
