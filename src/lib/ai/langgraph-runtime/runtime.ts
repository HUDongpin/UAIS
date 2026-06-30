import {
  Command,
  InMemoryStore,
  MemorySaver,
  type BaseCheckpointSaver,
  type BaseStore,
  type Item,
} from "@langchain/langgraph";
import { createUaisLangGraphExternalPersistence } from "@/lib/ai/langgraph-runtime/external-persistence";

export type UaisLangGraphActor = {
  actorId: string;
  role: "admin" | "educator" | "learner";
};

export type UaisLangGraphRedaction = {
  secrets: "omitted";
  localFiles: "omitted";
  assets: "ids-only";
};

export type UaisLangGraphCompileOptions = {
  checkpointer: BaseCheckpointSaver;
  store: BaseStore;
};

export type UaisLangGraphRuntimeEvent = {
  type: "node-update" | "interrupt";
  graphId: string;
  threadId: string;
  actor: UaisLangGraphActor;
  nodeId?: string;
  update?: unknown;
  interrupts?: UaisLangGraphInterrupt[];
  redaction: UaisLangGraphRedaction;
};

export type UaisLangGraphInterrupt = {
  id?: string;
  value: unknown;
};

export type UaisLangGraphSnapshot<TState> = {
  graphId: string;
  threadId: string;
  status: "completed" | "interrupted";
  values: TState;
  next: string[];
  interrupts: UaisLangGraphInterrupt[];
  redaction: UaisLangGraphRedaction;
};

export type UaisLangGraphRunResult<TState> =
  | {
      status: "completed";
      graphId: string;
      threadId: string;
      output: TState;
      events: UaisLangGraphRuntimeEvent[];
      redaction: UaisLangGraphRedaction;
    }
  | {
      status: "interrupted";
      graphId: string;
      threadId: string;
      events: UaisLangGraphRuntimeEvent[];
      interrupts: UaisLangGraphInterrupt[];
      redaction: UaisLangGraphRedaction;
    };

type RunnableLangGraph<TInput, TState> = {
  stream(
    input: TInput | Command<unknown> | unknown,
    options: {
      configurable: {
        thread_id: string;
      };
      streamMode: "updates";
    },
  ): Promise<AsyncIterable<unknown>>;
  getState(options: {
    configurable: {
      thread_id: string;
    };
  }): Promise<{
    values: TState;
    next?: unknown;
    tasks?: unknown;
  }>;
};

type CreateRuntimeInput = {
  checkpointer?: BaseCheckpointSaver;
  fetch?: typeof fetch;
  store?: BaseStore;
  env?: Record<string, string | undefined>;
  persistence?: UaisLangGraphPersistenceStatus;
};

export type UaisLangGraphPersistenceStatus =
  | {
      mode: "memory";
      checkpointer: "MemorySaver";
      store: "InMemoryStore";
    }
  | {
      mode: "external";
      checkpointer: string;
      store: string;
    };

type RunGraphInput<TInput, TState> = {
  graph: RunnableLangGraph<TInput, TState>;
  graphId: string;
  threadId: string;
  actor: UaisLangGraphActor;
  input: TInput;
};

type ResumeGraphInput<TState> = {
  graph: RunnableLangGraph<unknown, TState>;
  graphId: string;
  threadId: string;
  actor: UaisLangGraphActor;
  resume: unknown;
};

const redaction: UaisLangGraphRedaction = {
  secrets: "omitted",
  localFiles: "omitted",
  assets: "ids-only",
};

export function createUaisLangGraphMemoryCheckpointer() {
  return new MemorySaver();
}

export function createUaisLangGraphRuntime(input: CreateRuntimeInput = {}) {
  const externalPersistence =
    !input.checkpointer && !input.store && !input.persistence
      ? createUaisLangGraphExternalPersistence({
          env: input.env ?? process.env,
          fetch: input.fetch,
        })
      : undefined;
  const persistence =
    input.persistence ?? externalPersistence?.persistence ?? createMemoryPersistenceStatus();
  assertProductionPersistence({
    env: input.env ?? process.env,
    persistence,
    hasInjectedCheckpointer: Boolean(input.checkpointer ?? externalPersistence?.checkpointer),
    hasInjectedStore: Boolean(input.store ?? externalPersistence?.store),
  });
  const checkpointer =
    input.checkpointer ?? externalPersistence?.checkpointer ?? createUaisLangGraphMemoryCheckpointer();
  const store = input.store ?? externalPersistence?.store ?? new InMemoryStore();

  return {
    getPersistenceStatus(): UaisLangGraphPersistenceStatus {
      return persistence;
    },

    createCompileOptions(): UaisLangGraphCompileOptions {
      return {
        checkpointer,
        store,
      };
    },

    async run<TInput, TState>(
      runInput: RunGraphInput<TInput, TState>,
    ): Promise<UaisLangGraphRunResult<TState>> {
      return runGraph(runInput);
    },

    async resume<TState>(
      resumeInput: ResumeGraphInput<TState>,
    ): Promise<UaisLangGraphRunResult<TState>> {
      return runGraph({
        ...resumeInput,
        input: new Command({ resume: resumeInput.resume }),
      });
    },

    async getSnapshot<TState>(snapshotInput: {
      graph: RunnableLangGraph<unknown, TState>;
      graphId: string;
      threadId: string;
    }): Promise<UaisLangGraphSnapshot<TState>> {
      return getSnapshot(snapshotInput);
    },

    async storeMemory(input: {
      namespace: string[];
      key: string;
      value: Record<string, unknown>;
    }) {
      assertDisplaySafe(input);
      await store.put(input.namespace, input.key, input.value);
    },

    async readMemory<TValue>(input: {
      namespace: string[];
      key: string;
    }): Promise<(Item & { value: TValue }) | null> {
      assertDisplaySafe(input);
      const item = await store.get(input.namespace, input.key);
      assertDisplaySafe(item);
      return item as (Item & { value: TValue }) | null;
    },
  };
}

async function runGraph<TInput, TState>({
  graph,
  graphId,
  threadId,
  actor,
  input,
}: RunGraphInput<TInput, TState>): Promise<UaisLangGraphRunResult<TState>> {
  const safeGraphId = requireSafeId(graphId, "graph id");
  const safeThreadId = requireSafeId(threadId, "thread id");
  const safeActor = requireSafeActor(actor);
  const events: UaisLangGraphRuntimeEvent[] = [];

  const stream = await graph.stream(input, {
    configurable: {
      thread_id: safeThreadId,
    },
    streamMode: "updates",
  });

  for await (const chunk of stream) {
    events.push(
      ...createEventsForChunk({
        chunk,
        graphId: safeGraphId,
        threadId: safeThreadId,
        actor: safeActor,
      }),
    );
  }

  const snapshot = await getSnapshot<TState>({
    graph,
    graphId: safeGraphId,
    threadId: safeThreadId,
  });

  assertDisplaySafe({ events, snapshot });

  if (snapshot.status === "interrupted") {
    return {
      status: "interrupted",
      graphId: safeGraphId,
      threadId: safeThreadId,
      events,
      interrupts: snapshot.interrupts,
      redaction,
    };
  }

  return {
    status: "completed",
    graphId: safeGraphId,
    threadId: safeThreadId,
    output: snapshot.values,
    events,
    redaction,
  };
}

async function getSnapshot<TState>({
  graph,
  graphId,
  threadId,
}: {
  graph: RunnableLangGraph<unknown, TState>;
  graphId: string;
  threadId: string;
}): Promise<UaisLangGraphSnapshot<TState>> {
  const safeGraphId = requireSafeId(graphId, "graph id");
  const safeThreadId = requireSafeId(threadId, "thread id");
  const state = await graph.getState({
    configurable: {
      thread_id: safeThreadId,
    },
  });
  const next = readStringList(state.next);
  const interrupts = readInterruptsFromTasks(state.tasks);
  const snapshot: UaisLangGraphSnapshot<TState> = {
    graphId: safeGraphId,
    threadId: safeThreadId,
    status: interrupts.length > 0 || next.length > 0 ? "interrupted" : "completed",
    values: state.values,
    next,
    interrupts,
    redaction,
  };

  assertDisplaySafe(snapshot);
  return snapshot;
}

function createEventsForChunk(input: {
  chunk: unknown;
  graphId: string;
  threadId: string;
  actor: UaisLangGraphActor;
}) {
  const chunk = isRecord(input.chunk) ? input.chunk : {};
  const events: UaisLangGraphRuntimeEvent[] = [];

  for (const [key, value] of Object.entries(chunk)) {
    if (key === "__interrupt__") {
      const interrupts = readInterruptList(value);
      events.push({
        type: "interrupt",
        graphId: input.graphId,
        threadId: input.threadId,
        actor: input.actor,
        interrupts,
        redaction,
      });
      continue;
    }

    events.push({
      type: "node-update",
      graphId: input.graphId,
      threadId: input.threadId,
      actor: input.actor,
      nodeId: requireSafeId(key, "node id"),
      update: value,
      redaction,
    });
  }

  for (const event of events) {
    assertDisplaySafe(event);
  }
  return events;
}

function readInterruptsFromTasks(tasks: unknown): UaisLangGraphInterrupt[] {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.flatMap((task) => {
    if (!isRecord(task)) {
      return [];
    }
    return readInterruptList(task.interrupts);
  });
}

function readInterruptList(value: unknown): UaisLangGraphInterrupt[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((interrupt) => {
    if (!isRecord(interrupt)) {
      return {
        value: interrupt,
      };
    }
    return {
      ...(typeof interrupt.id === "string" ? { id: interrupt.id } : {}),
      value: interrupt.value,
    };
  });
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function requireSafeActor(actor: UaisLangGraphActor): UaisLangGraphActor {
  if (actor.role !== "admin" && actor.role !== "educator" && actor.role !== "learner") {
    throw new Error("Invalid UAIS LangGraph actor role.");
  }
  return {
    actorId: requireSafeId(actor.actorId, "actor id"),
    role: actor.role,
  };
}

function createMemoryPersistenceStatus(): UaisLangGraphPersistenceStatus {
  return {
    mode: "memory",
    checkpointer: "MemorySaver",
    store: "InMemoryStore",
  };
}

function assertProductionPersistence(input: {
  env: Record<string, string | undefined>;
  persistence: UaisLangGraphPersistenceStatus;
  hasInjectedCheckpointer: boolean;
  hasInjectedStore: boolean;
}) {
  if (!isUaisLangGraphProductionRuntime(input.env)) {
    return;
  }

  if (input.persistence.mode !== "external") {
    throw new Error(
      "UAIS LangGraph production runtime requires external persistence; configure a GCS-backed checkpointer/store or an external LangGraph runtime persistence adapter.",
    );
  }

  if (!input.hasInjectedCheckpointer || !input.hasInjectedStore) {
    throw new Error(
      "UAIS LangGraph external persistence requires injected checkpointer and store adapters.",
    );
  }
}

function isUaisLangGraphProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Invalid UAIS LangGraph ${label}.`);
  }
  return value;
}

function assertDisplaySafe(value: unknown) {
  const serialized = JSON.stringify(value);
  if (UNSAFE_LANGGRAPH_RUNTIME_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("UAIS LangGraph runtime event contains non-display-safe data.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const UNSAFE_LANGGRAPH_RUNTIME_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET)\s*=\s*[^"',}\]\s]+/,
  /voice-qwen-private/,
  /\/Users\/dongpinhu\//,
  /data:audio\/[^"',}\]\s]+base64/i,
  /audioBase64/i,
];
