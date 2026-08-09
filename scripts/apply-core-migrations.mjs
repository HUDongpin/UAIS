import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import postgres from "postgres";

const migrations = [
  {
    version: "0001_core_poc",
    path: "migrations/0001_core_poc.sql",
  },
  {
    version: "0002_teaching_operations",
    path: "migrations/0002_teaching_operations.sql",
  },
  {
    version: "0003_learning_chatroom",
    path: "migrations/0003_learning_chatroom.sql",
  },
];

const databaseUrlEnvNames = ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"];

function readDatabaseUrl() {
  for (const name of databaseUrlEnvNames) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return undefined;
}

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) {
  console.error(
    `Blocked: set one of ${databaseUrlEnvNames.join(", ")} before applying UAIS core migrations.`,
  );
  exit(1);
}

const sql = postgres(databaseUrl.value, {
  max: 1,
  prepare: false,
});
const checkpointer = PostgresSaver.fromConnString(databaseUrl.value, {
  schema: "uais_langgraph",
});
const store = PostgresStore.fromConnString(databaseUrl.value, {
  schema: "uais_langgraph",
  ensureTables: false,
});

try {
  await sql.begin(async (tx) => {
    await tx`
      CREATE TABLE IF NOT EXISTS uais_schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    for (const migration of migrations) {
      const migrationSql = await readFile(join(cwd(), migration.path), "utf8");
      const checksum = createHash("sha256").update(migrationSql).digest("hex");
      const applied = await tx`
        SELECT checksum FROM uais_schema_migrations WHERE version = ${migration.version}
      `;

      if (applied.length > 0) {
        if (applied[0].checksum !== checksum) {
          throw new Error(`Migration checksum mismatch for ${migration.version}.`);
        }
        continue;
      }

      await tx.unsafe(migrationSql);
      await tx`
        INSERT INTO uais_schema_migrations (version, checksum)
        VALUES (${migration.version}, ${checksum})
      `;
    }
  });
  await checkpointer.setup();
  await store.setup();

  console.log(
    JSON.stringify({
      target: "uais-core-database-migrations",
      status: "applied",
      selectedEnvName: databaseUrl.name,
      migrations: migrations.map((migration) => migration.version),
      langGraphPersistence: {
        checkpointer: "PostgresSaver",
        store: "PostgresStore",
        schema: "uais_langgraph",
        status: "applied",
      },
      valueRedacted: true,
    }),
  );
} finally {
  await checkpointer.end();
  await store.stop();
  await sql.end({ timeout: 5 });
}
