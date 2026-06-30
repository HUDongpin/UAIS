import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  createUaisLangGraphRuntime,
  type UaisLangGraphActor,
  type UaisLangGraphRuntimeEvent,
  type UaisLangGraphRunResult,
} from "@/lib/ai/langgraph-runtime/runtime";

export type UaisAgentWorkflowGraphNode = {
  id: string;
  dependsOn: string[];
};

export type UaisAgentWorkflowGraphValidation = {
  graphId: string;
  status: "valid";
  responsibleSession: "S07";
  nodeCount: number;
  edgeCount: number;
  topologicalOrder: string[];
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "ids-only";
  };
};

export type UaisAgentWorkflowGraphCompletedNode = {
  nodeId: string;
  output: unknown;
};

export type ExecuteUaisAgentWorkflowGraphInput = {
  graphId: string;
  nodes: UaisAgentWorkflowGraphNode[];
  threadId?: string;
  actor?: UaisLangGraphActor;
  env?: Record<string, string | undefined>;
  runNode?: (input: {
    node: UaisAgentWorkflowGraphNode;
    completedNodeIds: string[];
    validation: UaisAgentWorkflowGraphValidation;
  }) => Promise<unknown> | unknown;
};

export type UaisAgentWorkflowGraphExecution = {
  validation: UaisAgentWorkflowGraphValidation;
  completed: UaisAgentWorkflowGraphCompletedNode[];
  runtime: {
    engine: "uais-langgraph-production-runtime";
    graphId: string;
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

type UaisAgentWorkflowGraphExecutionState = {
  completed: UaisAgentWorkflowGraphCompletedNode[];
};

const WorkflowExecutionState = Annotation.Root({
  completed: Annotation<UaisAgentWorkflowGraphCompletedNode[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

export function validateUaisAgentWorkflowGraph(input: {
  graphId: string;
  nodes: UaisAgentWorkflowGraphNode[];
}): UaisAgentWorkflowGraphValidation {
  const graphId = requireSafeGraphId(input.graphId);
  const nodes = input.nodes.map((node) => ({
    id: requireSafeNodeId(node.id),
    dependsOn: node.dependsOn.map(requireSafeNodeId),
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) {
    throw new Error("UAIS agent workflow graph contains duplicate nodes.");
  }

  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!nodeIds.has(dependency)) {
        throw new Error(`UAIS agent workflow graph has missing dependency: ${dependency}.`);
      }
    }
  }

  const topologicalOrder = createStableTopologicalOrder(nodes);
  const validation: UaisAgentWorkflowGraphValidation = {
    graphId,
    status: "valid",
    responsibleSession: "S07",
    nodeCount: nodes.length,
    edgeCount: nodes.reduce((total, node) => total + node.dependsOn.length, 0),
    topologicalOrder,
    redaction: createRedaction(),
  };
  assertWorkflowGraphValidationIsDisplaySafe(validation);
  return validation;
}

export async function executeUaisAgentWorkflowGraph(
  input: ExecuteUaisAgentWorkflowGraphInput,
): Promise<UaisAgentWorkflowGraphExecution> {
  const validation = validateUaisAgentWorkflowGraph({
    graphId: input.graphId,
    nodes: input.nodes,
  });
  const nodesById = new Map(
    input.nodes.map((node) => [
      requireSafeNodeId(node.id),
      {
        id: requireSafeNodeId(node.id),
        dependsOn: node.dependsOn.map(requireSafeNodeId),
      },
    ]),
  );
  const runtime = createUaisLangGraphRuntime({
    env: input.env,
  });

  let graph: StateGraph<
    typeof WorkflowExecutionState,
    typeof WorkflowExecutionState.State,
    Partial<UaisAgentWorkflowGraphExecutionState>,
    string
  > = new StateGraph(WorkflowExecutionState);
  for (const nodeId of validation.topologicalOrder) {
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`UAIS agent workflow graph missing executable node: ${nodeId}.`);
    }
    graph = graph.addNode(nodeId, async (state) => {
      const completedNodeIds = state.completed.map((completed) => completed.nodeId);
      const output =
        input.runNode?.({
          node,
          completedNodeIds,
          validation,
        }) ?? {
          status: "completed",
        };
      const resolvedOutput = await output;
      const completed = [
        {
          nodeId,
          output: resolvedOutput,
        },
      ];
      assertWorkflowGraphValidationIsDisplaySafe(completed);
      return { completed };
    });
  }

  if (validation.topologicalOrder.length === 0) {
    throw new Error("UAIS agent workflow graph requires at least one node.");
  }

  let previousNodeId = START;
  for (const nodeId of validation.topologicalOrder) {
    graph = graph.addEdge(previousNodeId, nodeId);
    previousNodeId = nodeId;
  }
  const compiledGraph = graph.addEdge(previousNodeId, END).compile(runtime.createCompileOptions());
  const threadId = input.threadId ?? createWorkflowGraphThreadId(validation);
  const runtimeResult = await runtime.run<
    UaisAgentWorkflowGraphExecutionState,
    UaisAgentWorkflowGraphExecutionState
  >({
    graph: compiledGraph,
    graphId: validation.graphId,
    threadId,
    actor: input.actor ?? {
      actorId: "agent-workflow-runner",
      role: "educator",
    },
    input: {
      completed: [],
    },
  });
  const state = requireCompletedWorkflowGraphRuntime(runtimeResult);
  const result: UaisAgentWorkflowGraphExecution = {
    validation,
    completed: state.completed,
    runtime: {
      engine: "uais-langgraph-production-runtime",
      graphId: validation.graphId,
      status: "completed",
      threadId,
      eventCount: runtimeResult.events.length,
      redaction: createRedaction(),
    },
    runtimeEvents: runtimeResult.events,
  };

  assertWorkflowGraphValidationIsDisplaySafe(result);
  return result;
}

function createStableTopologicalOrder(nodes: UaisAgentWorkflowGraphNode[]) {
  const completed = new Set<string>();
  const remaining = new Set(nodes.map((node) => node.id));
  const topologicalOrder: string[] = [];

  while (remaining.size > 0) {
    let progressed = false;
    for (const node of nodes) {
      if (!remaining.has(node.id)) {
        continue;
      }
      if (!node.dependsOn.every((dependency) => completed.has(dependency))) {
        continue;
      }

      remaining.delete(node.id);
      completed.add(node.id);
      topologicalOrder.push(node.id);
      progressed = true;
    }

    if (!progressed) {
      throw new Error("UAIS agent workflow graph contains a cycle.");
    }
  }

  return topologicalOrder;
}

function requireSafeGraphId(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid UAIS agent workflow graph id.");
  }
  return value;
}

function requireSafeNodeId(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid UAIS agent workflow graph node id.");
  }
  return value;
}

function createRedaction(): UaisAgentWorkflowGraphValidation["redaction"] {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function requireCompletedWorkflowGraphRuntime(
  result: UaisLangGraphRunResult<UaisAgentWorkflowGraphExecutionState>,
) {
  if (result.status !== "completed") {
    throw new Error("UAIS agent workflow LangGraph runtime unexpectedly interrupted.");
  }
  return result.output;
}

function createWorkflowGraphThreadId(validation: UaisAgentWorkflowGraphValidation) {
  return `workflow-${hashWorkflowThreadSeed(
    `${validation.graphId}:${validation.topologicalOrder.join("|")}`,
  )}`;
}

function hashWorkflowThreadSeed(seed: string) {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function assertWorkflowGraphValidationIsDisplaySafe(value: unknown) {
  const serialized = JSON.stringify(value);
  if (UNSAFE_WORKFLOW_GRAPH_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("UAIS agent workflow graph contains non-display-safe data.");
  }
}

const UNSAFE_WORKFLOW_GRAPH_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET)\s*=\s*[^"',}\]\s]+/,
  /voice-qwen-private/,
  /\/Users\/dongpinhu\/Library\/Containers/,
  /data:audio\/[^"',}\]\s]+base64/i,
  /audioBase64/i,
];
