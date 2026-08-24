// Applies the UAIS core migrations.
//
// Two calling conventions, because a build and an operator need opposite
// failure modes:
//
//   node scripts/apply-core-migrations.mjs
//     Strict. No database URL is an error. This is `npm run db:migrate`, the
//     one an operator runs deliberately against a known target, where silence
//     would mean "I thought I migrated production and did not".
//
//   node scripts/apply-core-migrations.mjs --deploy
//     Build-safe. Used by `vercel-build`. Skips - exit 0 with a structured
//     record - in exactly two situations, and applies normally otherwise:
//
//     1. No database URL in the build environment. Coupling `next build` to
//        database availability is what took the production site stale: the
//        build env had no URL, the strict script exited 1, every deploy after
//        2026-08-08 failed, and nothing probed the live site to notice. A
//        missing URL must not be able to stop shipping the application.
//     2. A non-production Vercel deployment (`VERCEL_ENV` set and not
//        "production"). Preview builds share the project's environment, so the
//        old command let any preview branch migrate the production database.
//        Absent VERCEL_ENV entirely (self-hosted, CI, local) this does not
//        apply and the migration runs.
//
// A skip is reported, never silent, so the deploy log says which of the two
// cases happened. Pair it with the schema check on /healthz: if a skip left the
// database behind the code, that endpoint is where it surfaces.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import postgres from "postgres";
import {
  assertCoreMigrationDatabaseGuard,
  resolveCoreMigrationGuardContract,
} from "./core-migration-guard.mjs";

// Derived from the directory rather than hand-listed here. A hand-listed runner
// is a second inventory to keep in step with the files, and the cost of it
// falling behind is a deploy that reports "applied" having skipped the migration
// someone just added. The numeric filename prefix is the apply order, which is
// what the lexicographic sort produces. Runtime code that cannot read this
// directory - /healthz from a serverless bundle - reads the pinned projection in
// src/lib/db/migrations.ts instead, and a test holds the two together.
const migrationsDirectory = "migrations";
const migrations = (await readdir(join(cwd(), migrationsDirectory)))
  .filter((entry) => entry.endsWith(".sql"))
  .sort()
  .map((entry) => ({
    version: entry.slice(0, -".sql".length),
    path: join(migrationsDirectory, entry),
  }));

const databaseUrlEnvNames = ["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"];

function readDatabaseUrl() {
  for (const name of databaseUrlEnvNames) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return undefined;
}

const deployMode = argv.includes("--deploy");

const guardContract = resolveCoreMigrationGuardContract({ env, deployMode });
if (!guardContract.approved) {
  console.error(
    JSON.stringify({
      target: "uais-core-database-migrations",
      status: "BLOCKED_ENV",
      blockedReason: guardContract.blockedReason,
      valueRedacted: true,
    }),
  );
  exit(2);
}
const requiredDatabaseGuard = guardContract.requiredGuard;

function reportSkipped(skippedReason) {
  console.log(
    JSON.stringify({
      target: "uais-core-database-migrations",
      status: "skipped",
      skippedReason,
      mode: "deploy",
      migrations: migrations.map((migration) => migration.version),
      valueRedacted: true,
    }),
  );
}

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) {
  if (deployMode) {
    reportSkipped("missing-database-url");
    exit(0);
  }
  console.error(
    `Blocked: set one of ${databaseUrlEnvNames.join(", ")} before applying UAIS core migrations.`,
  );
  exit(1);
}

// Only Vercel sets VERCEL_ENV. Anywhere else - CI, a self-hosted box, a local
// run - the value is absent and this guard does nothing, which is why it tests
// for "set and not production" rather than "not production".
const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
if (deployMode && vercelEnv && vercelEnv !== "production") {
  reportSkipped("non-production-vercel-deployment");
  exit(0);
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
    await assertCoreMigrationDatabaseGuard({
      client: tx,
      requiredGuard: requiredDatabaseGuard,
    });
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
  await assertCoreMigrationDatabaseGuard({
    client: sql,
    requiredGuard: requiredDatabaseGuard,
  });
  await checkpointer.setup();
  await assertCoreMigrationDatabaseGuard({
    client: sql,
    requiredGuard: requiredDatabaseGuard,
  });
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
