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
  collectorKeyVersion: "v1",
  operatorAllowlistFingerprint: "c".repeat(64),
};

function storedSample(
  overrides: Partial<UaisStagingInpStoredSample> = {},
): UaisStagingInpStoredSample {
  return {
    ...binding,
    sampleKey: "1".padStart(64, "0"),
    metricIdKey: "2".repeat(64),
    operatorKey: "d".repeat(64),
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
    cohortReady?: boolean;
    existingSample?: boolean;
    schemaReady?: boolean;
    sessionReplicationRole?: string;
  } = {},
) {
  const calls: QueryCall[] = [];
  const guardReady = input.guardReady ?? true;
  const cohortReady = input.cohortReady ?? true;
  const existingSample = input.existingSample ?? false;
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
    if (
      text.includes("FROM public.uais_staging_inp_cohorts") &&
      text.includes("FOR UPDATE")
    ) {
      return cohortReady ? [
        {
          cohort_id: binding.cohortId,
          candidate_git_sha: binding.candidateGitSha,
          candidate_content_sha: binding.candidateContentSha,
          deployment_host: binding.deploymentHost,
          collector_key_version: binding.collectorKeyVersion,
          operator_allowlist_fingerprint: binding.operatorAllowlistFingerprint,
          lifecycle_state: "open",
          created_at: "2026-08-24T00:00:00.000Z",
          deadline_at: "2026-08-26T00:00:00.000Z",
          close_reason: null,
          closed_at: null,
          purged_at: null,
        },
      ] : [];
    }
    if (
      existingSample &&
      text.includes("FROM public.uais_staging_inp_samples") &&
      text.includes("sample_key") &&
      text.includes("LIMIT 1")
    ) {
      return [
        {
          candidate_git_sha: binding.candidateGitSha,
          candidate_content_sha: binding.candidateContentSha,
          deployment_host: binding.deploymentHost,
          collector_key_version: binding.collectorKeyVersion,
          operator_allowlist_fingerprint: binding.operatorAllowlistFingerprint,
          operator_key: "d".repeat(64),
          metric_id_key: "2".repeat(64),
          role: "student",
          journey: "student-learning",
          viewport_class: "wide",
          navigation_type: "navigate",
          value_ms: 180,
          update_count: 0,
          last_updated_at: "2026-08-24T00:10:00.000Z",
        },
      ];
    }
    if (
      existingSample &&
      text.startsWith("UPDATE public.uais_staging_inp_samples") &&
      text.includes("RETURNING 1 AS updated")
    ) {
      return [{ updated: 1 }];
    }
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

    await expect(store.setup(binding)).rejects.toEqual(
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

    await expect(store.setup(binding)).resolves.toEqual({
      status: "ready",
      cohortsTable: true,
      samplesTable: true,
      cohortState: "open",
      createdAt: "2026-08-24T00:00:00.000Z",
      deadlineAt: "2026-08-26T00:00:00.000Z",
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
      /UNIQUE \(\s*cohort_id, candidate_git_sha, candidate_content_sha, deployment_host, collector_key_version, operator_allowlist_fingerprint\s*\)/,
    );
    expect(sql).toContain("expires_at = received_at + interval '48 hours'");
    expect(sql).toContain("deadline_at = created_at + interval '48 hours'");
    expect(sql).toContain("operator_key");
    expect(sql).toContain("metric_id_key");
    expect(sql).toContain("update_count BETWEEN 0 AND 12");
    expect(sql).toContain("uais-staging-inp-v5");
    expect(sql).toMatch(
      /CREATE TEMP TABLE uais_staging_inp_contract_cohorts[\s\S]*?ON COMMIT DROP/,
    );
    expect(sql).toMatch(
      /CREATE TEMP TABLE uais_staging_inp_contract_samples[\s\S]*?ON COMMIT DROP/,
    );
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

    await expect(store.setup(binding)).rejects.toEqual(
      new UaisStagingInpStoreError(503, "staging-inp-schema-readback-failed"),
    );
  });

  it("fails closed when constraint triggers would run outside origin mode", async () => {
    const mock = createRecordingSqlDriver({ sessionReplicationRole: "replica" });
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.setup(binding)).rejects.toEqual(
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
      cohortsAutoClosed: 0,
      expiredRawSampleRowsDeleted: 1,
      expiredRawSampleRowsRemaining: 0,
      expiredRawSampleRowsZero: true,
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

  it("never creates a cohort implicitly from the persistence path", async () => {
    const mock = createRecordingSqlDriver({ cohortReady: false });
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.persist(storedSample())).rejects.toMatchObject({
      status: 409,
      reasonCode: "staging-inp-cohort-missing",
    });
    const sql = mock.calls.map((call) => call.text).join("\n");
    expect(sql).not.toContain("INSERT INTO public.uais_staging_inp_cohorts");
    expect(sql).not.toContain("INSERT INTO public.uais_staging_inp_samples");
  });

  it("keeps progressive updates bounded without extending sample expiry", async () => {
    const mock = createRecordingSqlDriver({ existingSample: true });
    const store = createUaisStagingInpPostgresStore({
      env: { UAIS_P2_STAGING_DATABASE_URL: databaseUrl },
      sqlFactory: mock.factory,
    });

    await expect(store.persist(storedSample({
      valueMs: 190,
      receivedAt: "2026-08-24T00:10:01.000Z",
      expiresAt: "2026-08-26T00:10:01.000Z",
    }))).resolves.toEqual({
      status: "updated",
    });
    const sql = mock.calls.map((call) => call.text).join("\n");
    const sampleUpdate = mock.calls.find((call) =>
      call.text.startsWith("UPDATE public.uais_staging_inp_samples"),
    );
    expect(sql).toContain("update_count < 12");
    expect(sql).toContain("interval '1 second'");
    expect(sql).not.toContain("GREATEST(");
    expect(sampleUpdate?.text).not.toContain("expires_at");
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
