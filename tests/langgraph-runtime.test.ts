import { describe, expect, it, vi } from "vitest";
import {
  Annotation,
  END,
  InMemoryStore,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import {
  createUaisLangGraphMemoryCheckpointer,
  createUaisLangGraphRuntime,
} from "@/lib/ai/langgraph-runtime/runtime";

type DemoApprovalState = {
  question: string;
  events: string[];
  approvals: string[];
};

const DemoApprovalStateAnnotation = Annotation.Root({
  question: Annotation<string>(),
  events: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  approvals: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

function createDemoApprovalGraph(
  runtime: ReturnType<typeof createUaisLangGraphRuntime>,
) {
  return new StateGraph(DemoApprovalStateAnnotation)
    .addNode("learning-advisor", (state) => ({
      events: [`advisor-reviewed:${state.question}`],
    }))
    .addNode("teacher-approval", () => {
      const decision = interrupt({
        kind: "teacher-approval",
        prompt: "Approve the AI teaching action before release.",
      });
      return {
        approvals: [String(decision)],
        events: [`approval:${String(decision)}`],
      };
    })
    .addEdge(START, "learning-advisor")
    .addEdge("learning-advisor", "teacher-approval")
    .addEdge("teacher-approval", END)
    .compile(runtime.createCompileOptions());
}

describe("UAIS LangGraph production runtime foundation", () => {
  it("streams node updates with graph, thread, actor, and redaction metadata", async () => {
    const runtime = createUaisLangGraphRuntime({
      checkpointer: createUaisLangGraphMemoryCheckpointer(),
    });
    const graph = createDemoApprovalGraph(runtime);

    const result = await runtime.run({
      graph,
      graphId: "learning-guide-production",
      threadId: "thread-learning-001",
      actor: {
        actorId: "learner-001",
        role: "learner",
      },
      input: {
        question: "把这页整理成 3 个学习要点",
        events: [],
        approvals: [],
      },
    });

    expect(result.status).toBe("interrupted");
    expect(result.events[0]).toEqual(
      expect.objectContaining({
        type: "node-update",
        graphId: "learning-guide-production",
        threadId: "thread-learning-001",
        actor: {
          actorId: "learner-001",
          role: "learner",
        },
        nodeId: "learning-advisor",
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          assets: "ids-only",
        },
      }),
    );
    expect(result.interrupts).toEqual([
      expect.objectContaining({
        value: {
          kind: "teacher-approval",
          prompt: "Approve the AI teaching action before release.",
        },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("/Users/");
    expect(JSON.stringify(result)).not.toContain("DASHSCOPE_API_KEY=");
  });

  it("resumes an interrupted thread from the saved checkpoint", async () => {
    const runtime = createUaisLangGraphRuntime({
      checkpointer: createUaisLangGraphMemoryCheckpointer(),
    });
    const graph = createDemoApprovalGraph(runtime);

    await runtime.run({
      graph,
      graphId: "teacher-ppt-production",
      threadId: "thread-teacher-ppt-001",
      actor: {
        actorId: "teacher-kang",
        role: "educator",
      },
      input: {
        question: "生成 PPT 讲解前需要教师确认",
        events: [],
        approvals: [],
      },
    });

    const interruptedSnapshot = await runtime.getSnapshot<DemoApprovalState>({
      graph,
      graphId: "teacher-ppt-production",
      threadId: "thread-teacher-ppt-001",
    });

    expect(interruptedSnapshot.status).toBe("interrupted");
    expect(interruptedSnapshot.next).toEqual(["teacher-approval"]);

    const resumed = await runtime.resume<DemoApprovalState>({
      graph,
      graphId: "teacher-ppt-production",
      threadId: "thread-teacher-ppt-001",
      actor: {
        actorId: "teacher-kang",
        role: "educator",
      },
      resume: "approved",
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.output).toMatchObject({
      approvals: ["approved"],
      events: ["advisor-reviewed:生成 PPT 讲解前需要教师确认", "approval:approved"],
    });

    const completedSnapshot = await runtime.getSnapshot<DemoApprovalState>({
      graph,
      graphId: "teacher-ppt-production",
      threadId: "thread-teacher-ppt-001",
    });
    expect(completedSnapshot.status).toBe("completed");
    expect(completedSnapshot.values.approvals).toEqual(["approved"]);
  });

  it("stores long-term memory in the runtime store without putting it in client output", async () => {
    const runtime = createUaisLangGraphRuntime({
      checkpointer: createUaisLangGraphMemoryCheckpointer(),
    });

    await runtime.storeMemory({
      namespace: ["learner", "learner-001"],
      key: "study-preferences",
      value: {
        locale: "zh-CN",
        scaffolding: "step-by-step",
      },
    });

    const item = await runtime.readMemory<{
      locale: string;
      scaffolding: string;
    }>({
      namespace: ["learner", "learner-001"],
      key: "study-preferences",
    });

    expect(item?.value).toEqual({
      locale: "zh-CN",
      scaffolding: "step-by-step",
    });
  });

  it("requires explicit external persistence for production runtime creation", () => {
    expect(() =>
      createUaisLangGraphRuntime({
        env: {
          NODE_ENV: "production",
        },
      }),
    ).toThrow(
      "UAIS LangGraph production runtime requires external persistence; configure a GCS-backed checkpointer/store or an external LangGraph runtime persistence adapter.",
    );

    const runtime = createUaisLangGraphRuntime({
      env: {
        NODE_ENV: "production",
      },
      checkpointer: createUaisLangGraphMemoryCheckpointer(),
      store: new InMemoryStore(),
      persistence: {
        mode: "external",
        checkpointer: "gcs-checkpointer-contract",
        store: "gcs-store-contract",
      },
    });

    expect(runtime.getPersistenceStatus()).toEqual({
      mode: "external",
      checkpointer: "gcs-checkpointer-contract",
      store: "gcs-store-contract",
    });
  });

  it("treats deployment production markers as production for persistence requirements", () => {
    const deploymentProductionEnvs = [
      { VERCEL_ENV: "production" },
      { UAIS_DEPLOYMENT_ENV: "production" },
    ] satisfies Array<Record<string, string>>;

    for (const env of deploymentProductionEnvs) {
      expect(() =>
        createUaisLangGraphRuntime({
          env,
        }),
      ).toThrow(
        "UAIS LangGraph production runtime requires external persistence; configure a GCS-backed checkpointer/store or an external LangGraph runtime persistence adapter.",
      );
    }
  });

  it("creates external LangGraph persistence adapters from production external storage env", async () => {
    const persistedSnapshots = new Map<string, unknown>();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const method = init?.method ?? "GET";
      if (method === "GET") {
        if (!persistedSnapshots.has(requestUrl)) {
          return Response.json(
            {
              error: "LangGraph persistence snapshot not found.",
              redaction: {
                secrets: "omitted",
                localFiles: "omitted",
                assets: "ids-only",
              },
            },
            { status: 404 },
          );
        }
        return Response.json(persistedSnapshots.get(requestUrl));
      }

      if (method === "PUT") {
        persistedSnapshots.set(requestUrl, JSON.parse(String(init?.body)));
        return Response.json({
          status: "persisted",
          storagePolicy: "external-redacted-langgraph-persistence",
          storageWritePolicy: "external-atomic-langgraph-snapshot",
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        });
      }

      return Response.json({ error: "unsupported" }, { status: 405 });
    });
    const runtime = createUaisLangGraphRuntime({
      env: {
        NODE_ENV: "production",
        UAIS_LANGGRAPH_PERSISTENCE_BACKEND: "external",
        UAIS_EXTERNAL_STORAGE_BASE_URL: "https://storage.example.test",
        UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "test-external-storage-token-strong-fixture",
      },
      fetch: fetchImpl,
    });
    const graph = createDemoApprovalGraph(runtime);

    const result = await runtime.run({
      graph,
      graphId: "learning-guide-production",
      threadId: "thread-learning-external-001",
      actor: {
        actorId: "learner-001",
        role: "learner",
      },
      input: {
        question: "把这页整理成 3 个学习要点",
        events: [],
        approvals: [],
      },
    });
    await runtime.storeMemory({
      namespace: ["learner", "learner-001"],
      key: "study-preferences",
      value: {
        locale: "zh-CN",
        scaffolding: "step-by-step",
      },
    });

    expect(result.status).toBe("interrupted");
    expect(runtime.getPersistenceStatus()).toEqual({
      mode: "external",
      checkpointer: "external-storage-langgraph-checkpointer",
      store: "external-storage-langgraph-store",
    });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        "https://storage.example.test/langgraph/checkpoints/uais-langgraph-production-runtime",
        "https://storage.example.test/langgraph/store/uais-langgraph-production-runtime",
      ]),
    );
    expect(JSON.stringify({ result, persistedSnapshots })).not.toContain(
      "test-external-storage-token-strong-fixture",
    );
  });

  it("rejects graph updates that contain non-display-safe data", async () => {
    const runtime = createUaisLangGraphRuntime({
      checkpointer: createUaisLangGraphMemoryCheckpointer(),
    });
    const unsafeGraph = new StateGraph(DemoApprovalStateAnnotation)
      .addNode("unsafe-agent", () => ({
        events: ["DASHSCOPE_API_KEY=secret-qwen"],
      }))
      .addEdge(START, "unsafe-agent")
      .addEdge("unsafe-agent", END)
      .compile(runtime.createCompileOptions());

    await expect(
      runtime.run({
        graph: unsafeGraph,
        graphId: "unsafe-provider-output",
        threadId: "thread-unsafe-001",
        actor: {
          actorId: "learner-001",
          role: "learner",
        },
        input: {
          question: "unsafe",
          events: [],
          approvals: [],
        },
      }),
    ).rejects.toThrow("UAIS LangGraph runtime event contains non-display-safe data.");
  });
});
