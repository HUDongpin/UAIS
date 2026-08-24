import { getUaisCoreDatabasePool, getUaisCoreDatabaseReadiness } from "@/lib/db/core-database";
import {
  UAIS_CORE_DATABASE_MIGRATION_VERSIONS,
  type UaisCoreDatabaseMigrationVersion,
} from "@/lib/db/migrations";
import { isUaisProductionRuntime } from "@/lib/server/production-database-adapter-evidence";
import { getUaisStagingDeploymentBinding } from "@/lib/server/uais-staging-deployment-binding";

// Liveness AND the two dependency facts the product cannot work without: that
// the database answers, and that it carries the schema this build was written
// against.
//
// This endpoint used to report `{ app: "ok" }` unconditionally, so a Neon
// outage - with every course list, invite join, approval, transcript and share
// link failing - showed green to any uptime monitor pointed at it. The whole
// point of an external check is to notice exactly that, and it could not.
//
// The second check exists because the build is allowed to ship without
// migrating. `scripts/apply-core-migrations.mjs --deploy` skips - correctly -
// when the BUILD environment has no database URL, so that a missing URL cannot
// stop shipping the application. The cost of that choice is a deployment whose
// code expects `uais_user_login_identifiers` and whose database has never heard
// of it: the site serves, `SELECT 1` succeeds, /healthz goes green, and every
// login 500s. A connectivity probe cannot see it. This one can.
//
// Failure semantics are chosen for a monitor, not for a human:
//   - database unreachable            -> 503. The site is not serving.
//   - database not configured, in a
//     production runtime              -> 503. A production deployment without a
//                                        core database is misconfigured, not
//                                        healthy; it is the state that silently
//                                        503s the whole teaching surface.
//   - database not configured, local  -> 200. A developer must not need Postgres
//                                        for the health endpoint to pass.
//   - migrations behind the build     -> 503, in every lane. A configured
//                                        database missing this build's tables is
//                                        broken wherever it runs, and the deploy
//                                        that produced it reported success.
//
// Both probes touch no application data and can leak nothing. Neither reports
// the error text - a driver message routinely carries the host and the user -
// only the classification, and the one list the body does carry is built from
// the in-code inventory rather than from rows the database returned.

type UaisDatabaseCheckStatus = "ok" | "unreachable" | "not-configured";

// "behind" is the actionable one: the connection works and the ledger is
// readable, and this build's inventory is not all in it. "unknown" covers a
// readable database with an unreadable ledger - the migration table absent
// entirely (nothing was ever applied) or not grantable to this role - which is
// equally a misconfiguration but cannot name which migration is missing.
type UaisMigrationCheckStatus = "ok" | "behind" | "unknown" | "not-configured";

type UaisHealthProbeResult = {
  database: UaisDatabaseCheckStatus;
  migrations: UaisMigrationCheckStatus;
  missingMigrations: readonly UaisCoreDatabaseMigrationVersion[];
};

type UaisHealthGetHandlerDeps = {
  now?: () => Date;
  env?: Record<string, string | undefined>;
  compiledStagingContentSha?: string;
  probeDatabase?: (input: {
    env: Record<string, string | undefined>;
  }) => Promise<UaisHealthProbeResult>;
};

// A health check that hangs is worse than one that fails: the monitor times out
// with no classification, and on a serverless platform the invocation is billed
// for the full duration. Well above a warm round trip, well below any sensible
// monitor timeout. It is one deadline for the whole probe, not one per query, so
// adding the currency check did not double the endpoint's worst case.
const databaseProbeTimeoutMs = 3000;

export function createUaisHealthGetHandler(deps: UaisHealthGetHandlerDeps = {}) {
  const env = deps.env ?? process.env;
  const probeDatabase = deps.probeDatabase ?? probeUaisCoreDatabase;

  return async function GET() {
    const probe = await withProbeTimeout(() => probeDatabase({ env }));
    const configurationOptional = !isUaisProductionRuntime(env);
    const healthy =
      (probe.database === "ok" ||
        (probe.database === "not-configured" && configurationOptional)) &&
      (probe.migrations === "ok" ||
        (probe.migrations === "not-configured" && configurationOptional));
    const deploymentBinding = getUaisStagingDeploymentBinding(
      env,
      deps.compiledStagingContentSha,
    );

    return Response.json(
      {
        status: healthy ? "ok" : "degraded",
        service: "uais",
        checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
        checks: {
          app: "ok",
          database: probe.database,
          migrations: probe.migrations,
        },
        // The redaction-safe reason for a `behind` result. Every name in it comes
        // from UAIS_CORE_DATABASE_MIGRATION_VERSIONS - repo-tracked file names -
        // and never from a row the database returned, so this body cannot echo
        // whatever a writer put in that table.
        ...(probe.missingMigrations.length > 0
          ? {
              migrationCurrency: {
                expected: UAIS_CORE_DATABASE_MIGRATION_VERSIONS.length,
                missing: probe.missingMigrations,
                valueRedacted: true,
              },
            }
          : {}),
        redaction: {
          secrets: "omitted",
          localFiles: "omitted",
          databaseUrl: "omitted",
        },
        ...(deploymentBinding ? { deploymentBinding } : {}),
      },
      {
        status: healthy ? 200 : 503,
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  };
}

async function probeUaisCoreDatabase(input: {
  env: Record<string, string | undefined>;
}): Promise<UaisHealthProbeResult> {
  if (getUaisCoreDatabaseReadiness(input.env).status !== "ready") {
    return {
      database: "not-configured",
      migrations: "not-configured",
      missingMigrations: [],
    };
  }

  const client = (() => {
    try {
      return getUaisCoreDatabasePool({ env: input.env });
    } catch {
      return undefined;
    }
  })();
  if (!client) {
    return { database: "unreachable", migrations: "unknown", missingMigrations: [] };
  }

  try {
    // Kept as its own statement rather than inferring connectivity from the
    // ledger read: a failing ledger read on a working connection is a different
    // fault with a different fix, and collapsing them would report a missing
    // migration table as an outage.
    await client.sql`SELECT 1`;
  } catch {
    // Deliberately swallowed rather than reported: a postgres.js error message
    // routinely carries the host, the database name and the user, and this body
    // is world-readable.
    return { database: "unreachable", migrations: "unknown", missingMigrations: [] };
  }

  try {
    const rows = await client.sql`SELECT version FROM uais_schema_migrations`;
    const applied = new Set(
      rows.map((row) => (row as { version?: unknown }).version).filter(isNonEmptyText),
    );
    const missing = UAIS_CORE_DATABASE_MIGRATION_VERSIONS.filter(
      (version) => !applied.has(version),
    );
    // A database ahead of the code - extra versions applied - is a normal state
    // during a rollout and is not a fault, so only absences count.
    return {
      database: "ok",
      migrations: missing.length === 0 ? "ok" : "behind",
      missingMigrations: missing,
    };
  } catch {
    return { database: "ok", migrations: "unknown", missingMigrations: [] };
  }
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

async function withProbeTimeout(
  run: () => Promise<UaisHealthProbeResult>,
): Promise<UaisHealthProbeResult> {
  const timedOut: UaisHealthProbeResult = {
    database: "unreachable",
    migrations: "unknown",
    missingMigrations: [],
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<UaisHealthProbeResult>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), databaseProbeTimeoutMs);
      }),
    ]);
  } catch {
    return timedOut;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
