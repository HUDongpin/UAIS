import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  UaisStagingInpStoreError,
  createUaisStagingInpPostgresStore,
  type UaisStagingInpStoredSample,
} from "@/lib/server/uais-staging-inp-store";

const databaseUrl = "postgres://redacted@example.test/uais";
const candidateGitSha = "a".repeat(40);
const binding = {
  cohortId: `p2-inp-${candidateGitSha}-run1`,
  candidateGitSha,
  candidateContentSha: "b".repeat(64),
  deploymentHost: "uais-staging-current-team.vercel.app",
};

function storedSample(
  overrides: Partial<UaisStagingInpStoredSample> = {},
): UaisStagingInpStoredSample {
  return {
    ...binding,
    sampleKey: "1".padStart(64, "0"),
    role: "student",
    journey: "student-learning",
    viewportClass: "wide",
    navigationType: "navigate",
    valueMs: 180,
    receivedAt: "2026-08-24T00:10:00.000Z",
    expiresAt: "2026-08-26T00:10:00.000Z",
    ...overrides,
  };
}

type QueryCall = {
  text: string;
  values: unknown[];
  inTransaction: boolean;
};

function createRecordingSqlDriver(
  input: {
    guardReady?: boolean;
    schemaReady?: boolean;
    sessionReplicationRole?: string;
  } = {},
) {
  const calls: QueryCall[] = [];
  const guardReady = input.guardReady ?? true;
  const schemaReady = input.schemaReady ?? true;
  const sessionReplicationRole = input.sessionReplicationRole ?? "origin";
  const execute = async (
    inTransaction: boolean,
    strings: TemplateStringsArray,
    values: unknown[],
  ) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ text, values, inTransaction });
    if (text.includes("uais_environment_guard")) {
      return guardReady
        ? [
            {
              environment: "isolated-p2-staging-source",
              session_replication_role: sessionReplicationRole,
            },
          ]
        : [];
    }
    if (text.includes("pg_advisory_xact_lock")) return [];
    if (text.includes("AS schema_ready")) {
      return [{ schema_ready: schemaReady }];
    }
    if (
      text.startsWith(
        "DELETE FROM public.uais_staging_inp_samples WHERE expires_at",
      )
    ) {
      return [{ deleted: 1 }];
    }
    return [];
  };

  type MockSql = ReturnType<typeof postgres>;
  const transaction = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => execute(true, strings, values)) as unknown as MockSql;
  Object.assign(transaction, {
    unsafe: async (query: string) => {
      calls.push({
        text: query.replace(/\s+/g, " ").trim(),
        values: [],
        inTransaction: true,
      });
      return [];
    },
  });

  const root = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => execute(false, strings, values)) as unknown as MockSql;
  const end = vi.fn(async () => undefined);
  Object.assign(root, {
    begin: async <T>(callback: (sql: MockSql) => Promise<T>) => callback(transaction),
    end,
  });
  const factory = vi.fn(() => root) as unknown as typeof postgres;
  return { calls, factory, end };
}

describe("staging INP guarded Postgres lifecycle", () => {
  it("fails closed before DDL when the internal staging-source guard is absent", async () => {
    const mock = createRecordingSqlDriver({ guardReady: false });
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.setup()).rejects.toEqual(
      new UaisStagingInpStoreError(503, "staging-inp-source-guard-required"),
    );
    expect(mock.calls.some((call) => call.inTransaction)).toBe(false);
    expect(mock.end).toHaveBeenCalledOnce();
  });

  it("creates release-bound tables and compares the exact catalog to canonical temp DDL", async () => {
    const mock = createRecordingSqlDriver();
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.setup()).resolves.toEqual({
      status: "ready",
      cohortsTable: true,
      samplesTable: true,
      valuesRedacted: true,
    });

    const sql = mock.calls.map((call) => call.text).join("\n");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.uais_staging_inp_cohorts",
    );
    expect(sql).toContain("candidate_git_sha");
    expect(sql).toContain("candidate_content_sha");
    expect(sql).toContain("deployment_host");
    expect(sql).toMatch(
      /UNIQUE \(\s*cohort_id, candidate_git_sha, candidate_content_sha, deployment_host\s*\)/,
    );
    expect(sql).toContain("expires_at = received_at + interval '48 hours'");
    expect(sql).toContain("uais-staging-inp-v4");
    expect(sql).toContain("CREATE TEMP TABLE uais_staging_inp_contract_cohorts");
    expect(sql).toContain("CREATE TEMP TABLE uais_staging_inp_contract_samples");
    expect(sql).toContain("REFERENCES pg_temp.uais_staging_inp_contract_cohorts");
    expect(sql).toContain("ON pg_temp.uais_staging_inp_contract_samples");
    expect(sql).toContain("FROM public.uais_environment_guard");
    expect(sql).toContain("pg_attrdef");
    expect(sql).toContain("default_expression");
    expect(sql).toContain("attcollation");
    expect(sql).toContain("pg_get_constraintdef");
    expect(sql).toContain("convalidated");
    expect(sql).toContain("pg_index");
    expect(sql).toContain("indisvalid");
    expect(sql).toContain("predicate_definition");
    expect(sql).toContain("relpersistence");
    expect(sql).toContain("relrowsecurity");
    expect(sql).toContain("relforcerowsecurity");
    expect(sql).toContain("pg_inherits");
    expect(sql).toContain("pg_trigger");
    expect(sql).toContain("pg_rewrite");
    expect(sql).toContain("pg_policy");
    expect(sql).toContain("catalog_internal_triggers");
    expect(sql).toContain("tgenabled");
    expect(sql).toContain("current_setting('session_replication_role')");
    expect(sql).not.toMatch(
      /(?:FROM|INTO|UPDATE|DELETE FROM|REFERENCES|ON) uais_(?:environment_guard|staging_inp_(?:cohorts|samples))\b/,
    );
  });

  it("fails setup when pre-existing tables drift from the exact schema contract", async () => {
    const mock = createRecordingSqlDriver({ schemaReady: false });
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.setup()).rejects.toEqual(
      new UaisStagingInpStoreError(503, "staging-inp-schema-readback-failed"),
    );
  });

  it("fails closed when constraint triggers would run outside origin mode", async () => {
    const mock = createRecordingSqlDriver({ sessionReplicationRole: "replica" });
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.setup()).rejects.toEqual(
      new UaisStagingInpStoreError(503, "staging-inp-source-guard-required"),
    );
    expect(mock.calls.some((call) => call.text.includes("CREATE TABLE"))).toBe(false);
  });

  it("runs independent expiry deletion behind the same database guard", async () => {
    const mock = createRecordingSqlDriver();
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.purgeExpired()).resolves.toEqual({
      deletedCount: 1,
      remainingExpiredCount: 0,
      zeroResidue: true,
      valuesRedacted: true,
    });
    expect(
      mock.calls.some(
        (call) =>
          call.inTransaction &&
          call.text.includes("DELETE FROM public.uais_staging_inp_samples") &&
          call.text.includes("expires_at <= now()"),
      ),
    ).toBe(true);
  });

  it("rejects a sample whose expiry is not exactly 48 hours after receipt", async () => {
    const mock = createRecordingSqlDriver();
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(
      store.persist(storedSample({ expiresAt: "2026-08-27T00:10:00.000Z" })),
    ).rejects.toMatchObject({
      status: 409,
      reasonCode: "staging-inp-sample-expiry-invalid",
    });
    expect(mock.factory).not.toHaveBeenCalled();
  });
});
