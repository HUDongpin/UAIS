import {
  InMemoryStore,
  MemorySaver,
  type Item,
  type Operation,
  type OperationResults,
} from "@langchain/langgraph";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";

type ExternalPersistenceConfig = {
  baseUrl: string;
  accessToken: string;
  namespace: string;
  fetch: typeof fetch;
};

type CheckpointerSnapshot = {
  kind: "langgraph-checkpointer";
  namespace: string;
  storage: unknown;
  writes: unknown;
};

type StoreSnapshot = {
  kind: "langgraph-store";
  namespace: string;
  data: Array<[string, Array<[string, SerializedItem]>]>;
};

type SerializedItem = Omit<Item, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export function createUaisLangGraphExternalPersistence(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}) {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_LANGGRAPH_PERSISTENCE_BACKEND",
    value: input.env.UAIS_LANGGRAPH_PERSISTENCE_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });

  if (!isExternalStorageBackendReadyContract(backendContract)) {
    return undefined;
  }

  const externalStorageConfig = createUaisExternalStorageConfig({ env: input.env });
  if (!externalStorageConfig) {
    return undefined;
  }

  const config: ExternalPersistenceConfig = {
    baseUrl: externalStorageConfig.baseUrl,
    accessToken: externalStorageConfig.accessToken,
    namespace: requireSafeNamespace(
      input.env.UAIS_LANGGRAPH_PERSISTENCE_NAMESPACE ??
        "uais-langgraph-production-runtime",
    ),
    fetch: input.fetch ?? fetch,
  };

  return {
    checkpointer: new UaisExternalStorageLangGraphCheckpointer(config),
    store: new UaisExternalStorageLangGraphStore(config),
    persistence: {
      mode: "external" as const,
      checkpointer: "external-storage-langgraph-checkpointer",
      store: "external-storage-langgraph-store",
    },
  };
}

export class UaisExternalStorageLangGraphCheckpointer extends MemorySaver {
  private hydrated = false;

  constructor(private readonly config: ExternalPersistenceConfig) {
    super();
  }

  async getTuple(...args: Parameters<MemorySaver["getTuple"]>) {
    await this.hydrate();
    return super.getTuple(...args);
  }

  async *list(...args: Parameters<MemorySaver["list"]>) {
    await this.hydrate();
    yield* super.list(...args);
  }

  async put(...args: Parameters<MemorySaver["put"]>) {
    await this.hydrate();
    const result = await super.put(...args);
    await this.persist();
    return result;
  }

  async putWrites(...args: Parameters<MemorySaver["putWrites"]>) {
    await this.hydrate();
    await super.putWrites(...args);
    await this.persist();
  }

  async deleteThread(...args: Parameters<MemorySaver["deleteThread"]>) {
    await this.hydrate();
    await super.deleteThread(...args);
    await this.persist();
  }

  private async hydrate() {
    if (this.hydrated) {
      return;
    }
    const snapshot = await readSnapshot<CheckpointerSnapshot>({
      config: this.config,
      path: "checkpoints",
    });
    if (snapshot) {
      this.storage = decodeBinary(snapshot.storage) as typeof this.storage;
      this.writes = decodeBinary(snapshot.writes) as typeof this.writes;
    }
    this.hydrated = true;
  }

  private async persist() {
    await writeSnapshot({
      config: this.config,
      path: "checkpoints",
      snapshot: {
        kind: "langgraph-checkpointer",
        namespace: this.config.namespace,
        storage: encodeBinary(this.storage),
        writes: encodeBinary(this.writes),
      } satisfies CheckpointerSnapshot,
    });
  }
}

export class UaisExternalStorageLangGraphStore extends InMemoryStore {
  private hydrated = false;

  constructor(private readonly config: ExternalPersistenceConfig) {
    super();
  }

  async batch<Op extends readonly Operation[]>(
    operations: Op,
  ): Promise<OperationResults<Op>> {
    await this.hydrate();
    const result = await super.batch(operations);
    if (operations.some((operation) => "value" in operation)) {
      await this.persist();
    }
    return result;
  }

  private async hydrate() {
    if (this.hydrated) {
      return;
    }
    const snapshot = await readSnapshot<StoreSnapshot>({
      config: this.config,
      path: "store",
    });
    if (snapshot) {
      setStoreData(this, decodeStoreData(snapshot.data));
    }
    this.hydrated = true;
  }

  private async persist() {
    await writeSnapshot({
      config: this.config,
      path: "store",
      snapshot: {
        kind: "langgraph-store",
        namespace: this.config.namespace,
        data: encodeStoreData(getStoreData(this)),
      } satisfies StoreSnapshot,
    });
  }
}

async function readSnapshot<TSnapshot>(input: {
  config: ExternalPersistenceConfig;
  path: "checkpoints" | "store";
}) {
  const response = await input.config.fetch(createSnapshotUrl(input.config, input.path), {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.config.accessToken}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error("External LangGraph persistence read failed.");
  }

  return (await response.json()) as TSnapshot;
}

async function writeSnapshot(input: {
  config: ExternalPersistenceConfig;
  path: "checkpoints" | "store";
  snapshot: CheckpointerSnapshot | StoreSnapshot;
}) {
  const response = await input.config.fetch(
    createSnapshotUrl(input.config, input.path),
    {
      method: "PUT",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.snapshot),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error("External LangGraph persistence write failed.");
  }
}

function createSnapshotUrl(config: ExternalPersistenceConfig, path: "checkpoints" | "store") {
  return `${config.baseUrl}/langgraph/${path}/${encodeURIComponent(config.namespace)}`;
}

function requireSafeNamespace(value: string) {
  const namespace = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(namespace)) {
    throw new Error("UAIS LangGraph external persistence namespace is invalid.");
  }
  return namespace;
}

function encodeBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      __type: "Uint8Array",
      base64: Buffer.from(value).toString("base64"),
    };
  }

  if (Array.isArray(value)) {
    return value.map(encodeBinary);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, encodeBinary(item)]),
    );
  }

  return value;
}

function decodeBinary(value: unknown): unknown {
  if (isRecord(value) && value.__type === "Uint8Array" && typeof value.base64 === "string") {
    return new Uint8Array(Buffer.from(value.base64, "base64"));
  }

  if (Array.isArray(value)) {
    return value.map(decodeBinary);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decodeBinary(item)]),
    );
  }

  return value;
}

function encodeStoreData(data: Map<string, Map<string, Item>>) {
  return Array.from(data.entries()).map(([namespace, items]) => [
    namespace,
    Array.from(items.entries()).map(([key, item]) => [
      key,
      {
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    ]),
  ]) satisfies StoreSnapshot["data"];
}

function decodeStoreData(data: StoreSnapshot["data"]) {
  return new Map(
    data.map(([namespace, items]) => [
      namespace,
      new Map(
        items.map(([key, item]) => [
          key,
          {
            ...item,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          },
        ]),
      ),
    ]),
  );
}

function getStoreData(store: InMemoryStore) {
  return (store as unknown as { data: Map<string, Map<string, Item>> }).data;
}

function setStoreData(store: InMemoryStore, data: Map<string, Map<string, Item>>) {
  (store as unknown as { data: Map<string, Map<string, Item>> }).data = data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
