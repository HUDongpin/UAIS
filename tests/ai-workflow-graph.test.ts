import { describe, expect, it } from "vitest";
import {
  executeUaisAgentWorkflowGraph,
  validateUaisAgentWorkflowGraph,
} from "@/lib/ai/orchestration/workflow-graph";

describe("UAIS agent workflow graph validation", () => {
  it("validates a stable acyclic handoff graph", () => {
    const graph = validateUaisAgentWorkflowGraph({
      graphId: "teacher-ppt-narration",
      nodes: [
        { id: "s12-auth", dependsOn: [] },
        { id: "s24-sample", dependsOn: ["s12-auth"] },
        { id: "s07-voice", dependsOn: ["s24-sample"] },
        { id: "s24-ppt", dependsOn: ["s12-auth"] },
        { id: "s19-provider", dependsOn: ["s12-auth"] },
        {
          id: "s24-narration",
          dependsOn: ["s07-voice", "s24-ppt", "s19-provider"],
        },
        { id: "s22-smoke", dependsOn: ["s24-narration"] },
      ],
    });

    expect(graph).toEqual({
      graphId: "teacher-ppt-narration",
      status: "valid",
      responsibleSession: "S07",
      nodeCount: 7,
      edgeCount: 8,
      topologicalOrder: [
        "s12-auth",
        "s24-sample",
        "s07-voice",
        "s24-ppt",
        "s19-provider",
        "s24-narration",
        "s22-smoke",
      ],
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        assets: "ids-only",
      },
    });
  });

  it("rejects missing dependencies and cycles", () => {
    expect(() =>
      validateUaisAgentWorkflowGraph({
        graphId: "missing-dependency",
        nodes: [{ id: "s24-narration", dependsOn: ["s07-voice"] }],
      }),
    ).toThrow("missing dependency");

    expect(() =>
      validateUaisAgentWorkflowGraph({
        graphId: "cycle",
        nodes: [
          { id: "s07-voice", dependsOn: ["s24-sample"] },
          { id: "s24-sample", dependsOn: ["s07-voice"] },
        ],
      }),
    ).toThrow("cycle");
  });

  it("executes the handoff graph through LangGraph nodes and returns runtime trace evidence", async () => {
    const result = await executeUaisAgentWorkflowGraph({
      graphId: "teacher-ppt-narration",
      threadId: "thread-teacher-ppt-workflow-001",
      actor: {
        actorId: "teacher-kang",
        role: "educator",
      },
      nodes: [
        { id: "s12-auth", dependsOn: [] },
        { id: "s24-sample", dependsOn: ["s12-auth"] },
        { id: "s07-voice", dependsOn: ["s24-sample"] },
        { id: "s24-ppt", dependsOn: ["s12-auth"] },
        { id: "s19-provider", dependsOn: ["s12-auth"] },
        {
          id: "s24-narration",
          dependsOn: ["s07-voice", "s24-ppt", "s19-provider"],
        },
        { id: "s22-smoke", dependsOn: ["s24-narration"] },
      ],
      runNode: async ({ node, completedNodeIds }) => ({
        status: "completed",
        summary: `${node.id} after ${completedNodeIds.join(",") || "start"}`,
      }),
    });

    expect(result.validation.status).toBe("valid");
    expect(result.runtime).toEqual(
      expect.objectContaining({
        engine: "uais-langgraph-production-runtime",
        graphId: "teacher-ppt-narration",
        status: "completed",
        threadId: "thread-teacher-ppt-workflow-001",
      }),
    );
    expect(result.completed.map((node) => node.nodeId)).toEqual([
      "s12-auth",
      "s24-sample",
      "s07-voice",
      "s24-ppt",
      "s19-provider",
      "s24-narration",
      "s22-smoke",
    ]);
    expect(result.runtimeEvents.map((event) => event.nodeId)).toEqual([
      "s12-auth",
      "s24-sample",
      "s07-voice",
      "s24-ppt",
      "s19-provider",
      "s24-narration",
      "s22-smoke",
    ]);
    expect(JSON.stringify(result)).not.toContain("/Users/");
    expect(JSON.stringify(result)).not.toContain("DASHSCOPE_API_KEY=");
  });
});
