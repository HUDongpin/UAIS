import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  UAIS_CORE_DATABASE_MIGRATION_VERSIONS,
  type UaisCoreDatabaseMigrationVersion,
} from "@/lib/db/migrations";
import {
  UAIS_PRODUCTION_NEON_PROJECT_ID,
  UAIS_STAGING_INP_PROJECT_ID,
} from "@/lib/observability/uais-staging-inp";
import * as schema from "@/lib/db/schema";

export const UAIS_CORE_DATABASE_ENV_NAMES = [
  "UAIS_CORE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;
export const UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME =
  "UAIS_P2_STAGING_DATABASE_URL" as const;

export type UaisCoreDatabaseEnvName =
  | (typeof UAIS_CORE_DATABASE_ENV_NAMES)[number]
  | typeof UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME;

export type UaisCoreDatabaseReadiness =
  | {
      target: "uais-core-database";
      status: "ready";
      providerClass: "managed-postgres";
      selectedEnvName: UaisCoreDatabaseEnvName;
      // The inventory this build expects the database to have, not a literal
      // pinned here: it said `["0001_core_poc"]` while the runner applied seven,
      // so every readiness report described a schema no deployment was running.
      // See src/lib/db/migrations.ts for where the list comes from.
      migrations: readonly UaisCoreDatabaseMigrationVersion[];
      valueRedacted: true;
    }
  | {
      target: "uais-core-database";
      status: "blocked";
      blockedReason: "missing-managed-postgres-url";
      acceptedEnvNames: readonly UaisCoreDatabaseEnvName[];
      valueRedacted: true;
    };

export function getUaisCoreDatabaseReadiness(
  env: Record<string, string | undefined>,
): UaisCoreDatabaseReadiness {
  const selectedEnvName = readSelectedDatabaseEnvName(env);
  if (!selectedEnvName) {
    return {
      target: "uais-core-database",
      status: "blocked",
      blockedReason: "missing-managed-postgres-url",
      acceptedEnvNames: isExactIsolatedStagingRuntime(env)
        ? [UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME]
        : UAIS_CORE_DATABASE_ENV_NAMES,
      valueRedacted: true,
    };
  }

  return {
    target: "uais-core-database",
    status: "ready",
    providerClass: "managed-postgres",
    selectedEnvName,
    migrations: UAIS_CORE_DATABASE_MIGRATION_VERSIONS,
    valueRedacted: true,
  };
}

export function createUaisCoreDatabase(input: {
  env: Record<string, string | undefined>;
  prepare?: boolean;
  max?: number;
}) {
  const databaseUrl = readSelectedDatabaseUrl(input.env);
  if (!databaseUrl) {
    throw new Error("UAIS core database URL is required for the Postgres adapter.");
  }

  const sql = postgres(databaseUrl, {
    max: input.max ?? 5,
    prepare: input.prepare ?? false,
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
    readiness: getUaisCoreDatabaseReadiness(input.env),
    redaction: {
      databaseUrl: "omitted" as const,
      credentials: "omitted" as const,
    },
  };
}

// Connection reuse for the snapshot stores.
//
// Every store used to call `createUaisCoreDatabase` per operation and
// `sql.end()` in a `finally`, so a single 5-second history poll opened and tore
// down two fresh Neon TLS connections. At roughly 200 students polling that is
// ~80 connection setups per second, sustained, against a budget sized for
// pooled access - which presents to a student as intermittent "history
// unavailable" rather than as an error anyone can act on.
//
// Copied from the accepted in-repo precedent at
// src/lib/ai/langgraph-runtime/postgres-persistence.ts: module-scoped cache,
// keyed on the RESOLVED URL rather than on the env object, rebuilding on a
// different URL instead of handing back a stale client.
//
// Three settings are load-bearing and differ from the disposable client above:
//   - `idle_timeout` / `max_lifetime`: the disposable client needed neither
//     because it was ended within the call. A memoized pool without them turns
//     a per-call socket into a per-container socket set held open forever, and
//     a frozen-then-reclaimed serverless container leaks its sockets until the
//     server times them out.
//   - `max: 2`: a serverless instance handles one request at a time; this is
//     headroom for a transaction plus a concurrent read, not a real pool size.
//     The multiplier that matters is instances, not connections per instance.
//   - `prepare: false`: what makes the client safe behind Neon's pooled
//     (`-pooler`) endpoint, which is the endpoint this change is for.
type UaisCoreDatabasePool = ReturnType<typeof createUaisCoreDatabasePool>;

let cachedCoreDatabasePool:
  | { databaseUrl: string; pool: UaisCoreDatabasePool }
  | undefined;

export function getUaisCoreDatabasePool(input: {
  env: Record<string, string | undefined>;
  // Accepted and ignored, so the stores' injectable `createDatabase` seam keeps
  // one call shape for both the pooled accessor and a test double. A pool sizes
  // itself; the per-call `max: 1` the stores pass was only ever meaningful for
  // a client that was created and destroyed inside the call.
  max?: number;
}): UaisCoreDatabasePool {
  const databaseUrl = readSelectedDatabaseUrl(input.env);
  if (!databaseUrl) {
    throw new Error("UAIS core database URL is required for the Postgres adapter.");
  }

  if (cachedCoreDatabasePool?.databaseUrl === databaseUrl) {
    return cachedCoreDatabasePool.pool;
  }

  const pool = createUaisCoreDatabasePool(databaseUrl);
  cachedCoreDatabasePool = { databaseUrl, pool };
  return pool;
}

function createUaisCoreDatabasePool(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 2,
    prepare: false,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    // Without this a database that is unreachable rather than merely slow -
    // wrong host, revoked network rule, Neon cold-start gone bad - leaves every
    // request hanging until the platform's own function timeout. Ten seconds is
    // long enough for a legitimate cold start and short enough that the caller
    // still gets to run its own degradation path.
    connect_timeout: 10,
  });

  return {
    // The marker `closeUaisCoreDatabaseClient` reads. A pooled client outlives
    // the operation that borrowed it; ending it in a caller's `finally` would
    // close the shared pool out from under every other in-flight caller.
    pooled: true as const,
    db: drizzle(sql, { schema }),
    sql,
    redaction: {
      databaseUrl: "omitted" as const,
      credentials: "omitted" as const,
    },
  };
}

// The release call every store now makes instead of `sql.end({ timeout: 5 })`.
//
// Pooled clients are kept; anything else - a disposable `createUaisCoreDatabase`
// result, or a test double injected through a store's `createDatabase` seam - is
// still closed exactly as before. That is deliberate: the suites assert
// `client.ended === 1` on every path including the conflict path, and those
// assertions are the contract for "the connection is released even when the
// write is rejected". A test double carries no `pooled` marker, so it keeps
// taking the closing branch and the assertions keep passing unchanged.
export async function closeUaisCoreDatabaseClient(client: {
  pooled?: boolean;
  sql: { end: (options?: { timeout?: number }) => Promise<void> | void };
}) {
  if (client.pooled) {
    return;
  }
  await client.sql.end({ timeout: 5 });
}

/** Test seam: drops the memoized pool so a suite cannot leak one across files. */
export async function resetUaisCoreDatabasePoolForTesting() {
  const cached = cachedCoreDatabasePool;
  cachedCoreDatabasePool = undefined;
  await cached?.pool.sql.end({ timeout: 5 });
}

export function readUaisCoreDatabaseUrl(env: Record<string, string | undefined>) {
  return readSelectedDatabaseUrl(env);
}

function readSelectedDatabaseEnvName(
  env: Record<string, string | undefined>,
): UaisCoreDatabaseEnvName | undefined {
  const genericName = UAIS_CORE_DATABASE_ENV_NAMES.find((name) => hasValue(env[name]));
  if (!isExactIsolatedStagingRuntime(env)) return genericName;
  if (genericName || !hasValue(env[UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME])) {
    return undefined;
  }
  const neonProjectId = env.NEON_PROJECT_ID?.trim() ?? "";
  if (!neonProjectId || neonProjectId === UAIS_PRODUCTION_NEON_PROJECT_ID) {
    return undefined;
  }
  return UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME;
}

function readSelectedDatabaseUrl(env: Record<string, string | undefined>) {
  const selectedEnvName = readSelectedDatabaseEnvName(env);
  return selectedEnvName ? env[selectedEnvName]?.trim() : undefined;
}

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim() !== "";
}

function isExactIsolatedStagingRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" &&
    env.VERCEL_PROJECT_ID === UAIS_STAGING_INP_PROJECT_ID &&
    env.UAIS_DEPLOYMENT_ENV === "staging" &&
    env.UAIS_LEARNING_CHATROOM_GROUPS_MODE === "on"
  );
}
