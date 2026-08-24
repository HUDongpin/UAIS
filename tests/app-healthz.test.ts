import { describe, expect, it } from "vitest";
import { createUaisHealthGetHandler } from "@/app/healthz/handler";
import { UAIS_CORE_DATABASE_MIGRATION_VERSIONS } from "@/lib/db/migrations";

// /healthz reported `{ app: "ok" }` unconditionally, so a Neon outage - with the
// course list, invite join, approvals, transcripts and share links all failing -
// showed green to every uptime monitor. These assertions are the contract that
// the endpoint now tells the truth about the one dependency the product cannot
// work without, and about whether that dependency carries this build's schema.

const checkedAt = () => new Date("2026-09-01T12:00:00.000Z");
const coreDatabase = { UAIS_CORE_DATABASE_URL: "postgres://user:pass@db.example.test/uais" };
const candidateGitSha = "a".repeat(40);
const candidateContentSha = "b".repeat(64);
const immutableStagingHost = "uais-staging-current-team.vercel.app";

const currentDatabase = async () =>
  ({ database: "ok", migrations: "ok", missingMigrations: [] }) as const;

describe("UAIS app health endpoint", () => {
  it("returns a redacted no-store liveness response for uptime checks", async () => {
    const getHealth = createUaisHealthGetHandler({
      now: checkedAt,
      env: coreDatabase,
      probeDatabase: currentDatabase,
    });

    const response = await getHealth();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "ok",
      service: "uais",
      checkedAt: "2026-09-01T12:00:00.000Z",
      checks: {
        app: "ok",
        database: "ok",
        migrations: "ok",
      },
      redaction: {
        secrets: "omitted",
        localFiles: "omitted",
        databaseUrl: "omitted",
      },
    });
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("attests an exact base staging deployment without exposing its host or requiring RUM secrets", async () => {
    const getHealth = createUaisHealthGetHandler({
      now: checkedAt,
      env: {
        ...coreDatabase,
        VERCEL_ENV: "production",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
        VERCEL_GIT_COMMIT_SHA: candidateGitSha,
        VERCEL_URL: immutableStagingHost,
        UAIS_DEPLOYMENT_ENV: "staging",
        UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
        UAIS_STAGING_INP_RUM_ENABLED: "no",
        P2_CANDIDATE_GIT_SHA: candidateGitSha,
        P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
      },
      compiledStagingContentSha: candidateContentSha,
      probeDatabase: currentDatabase,
    });

    const response = await getHealth();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.deploymentBinding).toEqual({
      status: "bound",
      lane: "isolated-staging",
      project: "uais-staging",
      stagingInpRum: "disabled",
      candidateGitSha,
      candidateContentSha,
      deploymentHostFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      valuesRedacted: true,
    });
    expect(serialized).not.toContain(immutableStagingHost);
    expect(serialized).not.toContain(coreDatabase.UAIS_CORE_DATABASE_URL);
  });

  it("fails the check when the database is unreachable", async () => {
    const getHealth = createUaisHealthGetHandler({
      now: checkedAt,
      env: coreDatabase,
      probeDatabase: async () =>
        ({ database: "unreachable", migrations: "unknown", missingMigrations: [] }) as const,
    });

    const response = await getHealth();
    const body = await response.json();

    // 503, not 200-with-a-warning: a monitor acts on the status code.
    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("unreachable");
  });

  it("never reports the driver error or the connection string", async () => {
    const getHealth = createUaisHealthGetHandler({
      now: checkedAt,
      env: coreDatabase,
      probeDatabase: async () => {
        throw new Error("connect ECONNREFUSED db.example.test:5432 as user 'uais_app'");
      },
    });

    const body = await (await getHealth()).json();
    const serialized = JSON.stringify(body);

    expect(body.checks.database).toBe("unreachable");
    expect(serialized).not.toContain("db.example.test");
    expect(serialized).not.toContain("uais_app");
    expect(serialized).not.toContain("ECONNREFUSED");
  });

  it("passes locally without a database but fails a production runtime without one", async () => {
    const probeDatabase = async () =>
      ({
        database: "not-configured",
        migrations: "not-configured",
        missingMigrations: [],
      }) as const;

    // A developer must not need Postgres for the health endpoint to pass.
    const local = await createUaisHealthGetHandler({ now: checkedAt, env: {}, probeDatabase })();
    expect(local.status).toBe(200);
    expect((await local.json()).checks.database).toBe("not-configured");

    // A production deployment with no core database is misconfigured, not
    // healthy - it is the state that silently 503s the whole teaching surface.
    const deployed = await createUaisHealthGetHandler({
      now: checkedAt,
      env: { UAIS_DEPLOYMENT_ENV: "production" },
      probeDatabase,
    })();
    expect(deployed.status).toBe(503);
  });

  it("does not hang when the probe never settles", async () => {
    const getHealth = createUaisHealthGetHandler({
      now: checkedAt,
      env: coreDatabase,
      probeDatabase: () => new Promise(() => {}),
    });

    // A health check that hangs is worse than one that fails: the monitor times
    // out with no classification and the invocation is billed for the full
    // duration. The route's own deadline resolves it as unreachable, and it
    // classifies the currency check it never got to run rather than claiming it
    // passed.
    const response = await getHealth();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.database).toBe("unreachable");
    expect(body.checks.migrations).toBe("unknown");
    expect(body.migrationCurrency).toBeUndefined();
  }, 10000);

  // Migration currency. `apply-core-migrations.mjs --deploy` skips when the BUILD
  // environment has no database URL, so a green deploy can leave the running
  // code expecting tables the database has never had. `SELECT 1` succeeds
  // throughout; only this check sees it.
  describe("migration currency", () => {
    it("reports which migrations the database is missing, and 503s on it", async () => {
      const getHealth = createUaisHealthGetHandler({
        now: checkedAt,
        env: coreDatabase,
        probeDatabase: async () =>
          ({
            database: "ok",
            migrations: "behind",
            missingMigrations: ["0005_user_login_identifiers"],
          }) as const,
      });

      const response = await getHealth();
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.status).toBe("degraded");
      // The connection is fine; saying so is what makes the report actionable.
      expect(body.checks.database).toBe("ok");
      expect(body.checks.migrations).toBe("behind");
      expect(body.migrationCurrency).toEqual({
        expected: UAIS_CORE_DATABASE_MIGRATION_VERSIONS.length,
        missing: ["0005_user_login_identifiers"],
        valueRedacted: true,
      });
    });

    it("fails a configured local database too, not only a production runtime", async () => {
      // Unlike a missing URL, a configured database without this build's tables
      // is broken in every lane: the login route 500s on it wherever it runs.
      const response = await createUaisHealthGetHandler({
        now: checkedAt,
        env: coreDatabase,
        probeDatabase: async () =>
          ({
            database: "ok",
            migrations: "behind",
            missingMigrations: [...UAIS_CORE_DATABASE_MIGRATION_VERSIONS],
          }) as const,
      })();

      expect(response.status).toBe(503);
    });

    it("degrades when the migration ledger cannot be read at all", async () => {
      // The table absent entirely - nothing was ever applied - or not readable
      // by this role. Neither can name a missing version, and neither is healthy.
      const response = await createUaisHealthGetHandler({
        now: checkedAt,
        env: coreDatabase,
        probeDatabase: async () =>
          ({ database: "ok", migrations: "unknown", missingMigrations: [] }) as const,
      })();
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.checks.migrations).toBe("unknown");
      expect(body.migrationCurrency).toBeUndefined();
    });

    it("stays green when the database carries every migration this build expects", async () => {
      const response = await createUaisHealthGetHandler({
        now: checkedAt,
        env: { ...coreDatabase, UAIS_DEPLOYMENT_ENV: "production" },
        probeDatabase: currentDatabase,
      })();

      expect(response.status).toBe(200);
      expect((await response.json()).checks.migrations).toBe("ok");
    });
  });
});
