import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { readUaisCoreDatabaseUrl } from "@/lib/db/core-database";

const langGraphPostgresSchema = "uais_langgraph";
type UaisLangGraphPostgresPersistence = ReturnType<
  typeof createPostgresPersistenceAdapters
>;

let cachedPostgresPersistence:
  | {
      databaseUrl: string;
      adapters: UaisLangGraphPostgresPersistence;
    }
  | undefined;

export function createUaisLangGraphPostgresPersistence(input: {
  env: Record<string, string | undefined>;
}) {
  if (!isPostgresPersistenceSelector(input.env.UAIS_LANGGRAPH_PERSISTENCE_BACKEND)) {
    return undefined;
  }

  const databaseUrl = readUaisCoreDatabaseUrl(input.env);
  if (!databaseUrl) {
    return undefined;
  }

  if (cachedPostgresPersistence?.databaseUrl === databaseUrl) {
    return cachedPostgresPersistence.adapters;
  }

  const adapters = createPostgresPersistenceAdapters(databaseUrl);
  cachedPostgresPersistence = {
    databaseUrl,
    adapters,
  };
  return adapters;
}

function createPostgresPersistenceAdapters(databaseUrl: string) {
  return {
    checkpointer: PostgresSaver.fromConnString(databaseUrl, {
      schema: langGraphPostgresSchema,
    }),
    store: PostgresStore.fromConnString(databaseUrl, {
      schema: langGraphPostgresSchema,
      ensureTables: false,
    }),
    persistence: {
      mode: "external" as const,
      checkpointer: "PostgresSaver",
      store: "PostgresStore",
    },
  };
}

function isPostgresPersistenceSelector(value: string | undefined) {
  const selector = value?.trim().toLowerCase();
  return selector === "postgres" || selector === "managed";
}
