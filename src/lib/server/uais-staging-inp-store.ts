import postgres, { type TransactionSql } from "postgres";
import {
  UAIS_STAGING_INP_COHORT_CAP,
  UAIS_STAGING_INP_HOURLY_ID_CAP,
  UAIS_STAGING_INP_TTL_HOURS,
  type UaisStagingInpBinding,
  type UaisStagingInpJourney,
  type UaisStagingInpNavigationType,
  type UaisStagingInpViewportClass,
} from "@/lib/observability/uais-staging-inp";

export type UaisStagingInpRole = "student" | "teacher";
export type UaisStagingInpCohortState = "open" | "closed" | "purged";

export type UaisStagingInpStoredSample = UaisStagingInpBinding & {
  sampleKey: string;
  role: UaisStagingInpRole;
  journey: UaisStagingInpJourney;
  viewportClass: UaisStagingInpViewportClass;
  navigationType: UaisStagingInpNavigationType;
  valueMs: number;
  receivedAt: string;
  expiresAt: string;
};

export type UaisStagingInpAggregate = {
  role: UaisStagingInpRole;
  journey: UaisStagingInpJourney;
  viewportClass: UaisStagingInpViewportClass;
  n: number;
  p75Ms: number;
};

export type UaisStagingInpAggregateReceipt = UaisStagingInpBinding & {
  state: "closed";
  groups: UaisStagingInpAggregate[];
};

export type UaisStagingInpPurgeReceipt = UaisStagingInpBinding & {
  state: "purged";
  deletedCount: number;
  remainingForBinding: number;
  zeroResidue: boolean;
};

export type UaisStagingInpReadbackReceipt = UaisStagingInpBinding & {
  state: UaisStagingInpCohortState;
  remainingForBinding: number;
};

export type UaisStagingInpReadinessReceipt = UaisStagingInpBinding & {
  state: Exclude<UaisStagingInpCohortState, "purged">;
  groups: UaisStagingInpAggregate[];
};

type UaisStagingInpCohortRecord = UaisStagingInpBinding & {
  state: UaisStagingInpCohortState;
  closedAt: string | null;
  purgedAt: string | null;
};

export class UaisStagingInpStoreError extends Error {
  readonly status: 409 | 429 | 503;
  readonly reasonCode:
    | "staging-inp-hourly-limit-reached"
    | "staging-inp-cohort-cap-reached"
    | "staging-inp-source-guard-required"
    | "staging-inp-cohort-binding-mismatch"
    | "staging-inp-cohort-closed"
    | "staging-inp-cohort-purged"
    | "staging-inp-cohort-missing"
    | "staging-inp-cohort-state-invalid"
    | "staging-inp-sample-identity-conflict"
    | "staging-inp-sample-expiry-invalid"
    | "staging-inp-schema-readback-failed"
    | "staging-inp-database-unavailable";

  constructor(
    status: UaisStagingInpStoreError["status"],
    reasonCode: UaisStagingInpStoreError["reasonCode"],
  ) {
    super(reasonCode);
    this.name = "UaisStagingInpStoreError";
    this.status = status;
    this.reasonCode = reasonCode;
  }
}

export function createInMemoryUaisStagingInpStore(
  input: { now?: () => Date } = {},
) {
  const now = input.now ?? (() => new Date());
  let samples: UaisStagingInpStoredSample[] = [];
  const cohorts = new Map<string, UaisStagingInpCohortRecord>();

  function removeExpired() {
    samples = samples.filter((item) => Date.parse(item.expiresAt) > now().getTime());
  }

  function requireCohort(binding: UaisStagingInpBinding) {
    const cohort = cohorts.get(binding.cohortId);
    if (!cohort) {
      throw new UaisStagingInpStoreError(409, "staging-inp-cohort-missing");
    }
    assertBinding(cohort, binding);
    return cohort;
  }

  return {
    async setup() {
      return {
        status: "ready" as const,
        cohortsTable: true,
        samplesTable: true,
        valuesRedacted: true as const,
      };
    },
    async persist(sample: UaisStagingInpStoredSample) {
      assertSampleExpiry(sample);
      removeExpired();
      let cohort = cohorts.get(sample.cohortId);
      if (!cohort) {
        cohort = {
          ...bindingFromSample(sample),
          state: "open",
          closedAt: null,
          purgedAt: null,
        };
        cohorts.set(sample.cohortId, cohort);
      }
      assertBinding(cohort, sample);
      assertOpenCohort(cohort);

      const existing = samples.find(
        (item) => item.cohortId === sample.cohortId && item.sampleKey === sample.sampleKey,
      );
      if (existing) {
        assertSameSampleIdentity(existing, sample);
        existing.valueMs = Math.max(existing.valueMs, sample.valueMs);
        return { status: "updated" as const };
      }

      const cohortSamples = samples.filter((item) => sameBinding(item, sample));
      if (cohortSamples.length >= UAIS_STAGING_INP_COHORT_CAP) {
        throw new UaisStagingInpStoreError(429, "staging-inp-cohort-cap-reached");
      }
      const sampleHour = utcHour(sample.receivedAt);
      const hourlyCount = cohortSamples.filter(
        (item) =>
          item.role === sample.role &&
          item.journey === sample.journey &&
          utcHour(item.receivedAt) === sampleHour,
      ).length;
      if (hourlyCount >= UAIS_STAGING_INP_HOURLY_ID_CAP) {
        throw new UaisStagingInpStoreError(429, "staging-inp-hourly-limit-reached");
      }
      samples.push({ ...sample });
      return { status: "stored" as const };
    },
    async aggregate(
      binding: UaisStagingInpBinding,
    ): Promise<UaisStagingInpAggregateReceipt> {
      removeExpired();
      const cohort = requireCohort(binding);
      if (cohort.state === "purged") {
        throw new UaisStagingInpStoreError(409, "staging-inp-cohort-purged");
      }
      if (cohort.state === "open") {
        cohort.state = "closed";
        cohort.closedAt = now().toISOString();
      }
      return {
        ...binding,
        state: "closed",
        groups: aggregateSamples(samples.filter((item) => sameBinding(item, binding))),
      };
    },
    async readiness(
      binding: UaisStagingInpBinding,
    ): Promise<UaisStagingInpReadinessReceipt> {
      removeExpired();
      const cohort = requireCohort(binding);
      if (cohort.state === "purged") {
        throw new UaisStagingInpStoreError(409, "staging-inp-cohort-purged");
      }
      return {
        ...binding,
        state: cohort.state,
        groups: aggregateSamples(samples.filter((item) => sameBinding(item, binding))),
      };
    },
    async purge(binding: UaisStagingInpBinding): Promise<UaisStagingInpPurgeReceipt> {
      const cohort = requireCohort(binding);
      const timestamp = now().toISOString();
      if (cohort.state === "open") cohort.closedAt = timestamp;
      if (cohort.state !== "purged") cohort.purgedAt = timestamp;
      cohort.state = "purged";
      const before = samples.length;
      samples = samples.filter((item) => !sameBinding(item, binding));
      const deletedCount = before - samples.length;
      const remainingForBinding = samples.filter((item) => sameBinding(item, binding)).length;
      return {
        ...binding,
        state: "purged",
        deletedCount,
        remainingForBinding,
        zeroResidue: remainingForBinding === 0,
      };
    },
    async readback(
      binding: UaisStagingInpBinding,
    ): Promise<UaisStagingInpReadbackReceipt> {
      const cohort = requireCohort(binding);
      return {
        ...binding,
        state: cohort.state,
        remainingForBinding: samples.filter((item) => sameBinding(item, binding)).length,
      };
    },
    async purgeExpired() {
      const before = samples.length;
      removeExpired();
      return {
        deletedCount: before - samples.length,
        remainingExpiredCount: 0,
        zeroResidue: true,
        valuesRedacted: true as const,
      };
    },
  };
}

/**
 * Isolated-staging-only adapter. Construction is side-effect free. Every
 * operation opens a short-lived connection, verifies the database's internal
 * `isolated-p2-staging-source` guard, and only then reads or mutates the
 * TTL-bound staging evidence tables. The application route never invokes
 * `setup()`; schema creation is an explicit lifecycle action owned by the
 * staging operator. Purge deletes raw samples but retains the cohort tombstone
 * so a one-use run identifier cannot silently reopen.
 */
export function createUaisStagingInpPostgresStore(
  input: {
    env?: Record<string, string | undefined>;
    sqlFactory?: typeof postgres;
  } = {},
) {
  const env = input.env ?? process.env;
  const databaseUrl = env.UAIS_P2_STAGING_DATABASE_URL?.trim();
  const sqlFactory = input.sqlFactory ?? postgres;

  return {
    async setup() {
      return withGuardedStagingInpClient(databaseUrl, sqlFactory, async (sql) =>
        sql.begin(async (transaction) => {
          await assertPostgresSourceGuard(transaction);
          await lockPostgresLifecycle(transaction);
          const cohortsDdl = `
            CREATE TABLE IF NOT EXISTS public.uais_staging_inp_cohorts (
              cohort_id text NOT NULL,
              candidate_git_sha text NOT NULL,
              candidate_content_sha text NOT NULL,
              deployment_host text NOT NULL,
              lifecycle_state text NOT NULL DEFAULT 'open',
              created_at timestamptz NOT NULL DEFAULT now(),
              closed_at timestamptz,
              purged_at timestamptz,
              CONSTRAINT uais_staging_inp_cohorts_pkey PRIMARY KEY (cohort_id),
              CONSTRAINT uais_staging_inp_cohort_id_ck CHECK (
                cohort_id ~ '^p2-inp-[0-9a-f]{40}-[a-z0-9][a-z0-9-]{0,15}$'
              ),
              CONSTRAINT uais_staging_inp_cohort_git_sha_ck CHECK (
                candidate_git_sha ~ '^[0-9a-f]{40}$'
              ),
              CONSTRAINT uais_staging_inp_cohort_content_sha_ck CHECK (
                candidate_content_sha ~ '^[0-9a-f]{64}$'
              ),
              CONSTRAINT uais_staging_inp_cohort_host_ck CHECK (
                deployment_host ~ '^uais-staging-[a-z0-9-]+\\.vercel\\.app$'
              ),
              CONSTRAINT uais_staging_inp_cohort_state_ck CHECK (
                lifecycle_state IN ('open', 'closed', 'purged')
              ),
              CONSTRAINT uais_staging_inp_cohort_binding_unique UNIQUE (
                cohort_id,
                candidate_git_sha,
                candidate_content_sha,
                deployment_host
              ),
              CONSTRAINT uais_staging_inp_cohort_lifecycle_ck CHECK (
                (lifecycle_state = 'open' AND closed_at IS NULL AND purged_at IS NULL)
                OR (
                  lifecycle_state = 'closed'
                  AND closed_at IS NOT NULL
                  AND purged_at IS NULL
                )
                OR (
                  lifecycle_state = 'purged'
                  AND closed_at IS NOT NULL
                  AND purged_at IS NOT NULL
                )
              )
            )
          `;
          const samplesDdl = `
            CREATE TABLE IF NOT EXISTS public.uais_staging_inp_samples (
              cohort_id text NOT NULL,
              sample_key text NOT NULL,
              candidate_git_sha text NOT NULL,
              candidate_content_sha text NOT NULL,
              deployment_host text NOT NULL,
              role text NOT NULL,
              journey text NOT NULL,
              viewport_class text NOT NULL,
              navigation_type text NOT NULL,
              value_ms integer NOT NULL,
              received_at timestamptz NOT NULL,
              expires_at timestamptz NOT NULL,
              CONSTRAINT uais_staging_inp_sample_key_ck CHECK (
                sample_key ~ '^[0-9a-f]{64}$'
              ),
              CONSTRAINT uais_staging_inp_sample_git_sha_ck CHECK (
                candidate_git_sha ~ '^[0-9a-f]{40}$'
              ),
              CONSTRAINT uais_staging_inp_sample_content_sha_ck CHECK (
                candidate_content_sha ~ '^[0-9a-f]{64}$'
              ),
              CONSTRAINT uais_staging_inp_sample_host_ck CHECK (
                deployment_host ~ '^uais-staging-[a-z0-9-]+\\.vercel\\.app$'
              ),
              CONSTRAINT uais_staging_inp_sample_role_ck CHECK (
                role IN ('student', 'teacher')
              ),
              CONSTRAINT uais_staging_inp_sample_journey_ck CHECK (journey IN (
                'student-learning', 'student-chatroom', 'teacher-home',
                'teacher-course-settings', 'teacher-activities',
                'teacher-submissions'
              )),
              CONSTRAINT uais_staging_inp_sample_viewport_ck CHECK (
                viewport_class IN ('compact', 'wide')
              ),
              CONSTRAINT uais_staging_inp_sample_navigation_ck CHECK (
                navigation_type IN (
                  'navigate', 'reload', 'back-forward', 'back-forward-cache',
                  'prerender', 'restore'
                )
              ),
              CONSTRAINT uais_staging_inp_sample_value_ck CHECK (
                value_ms BETWEEN 0 AND 60000
              ),
              CONSTRAINT uais_staging_inp_sample_expiry_ck CHECK (
                expires_at = received_at + interval '48 hours'
              ),
              CONSTRAINT uais_staging_inp_samples_pkey PRIMARY KEY (
                cohort_id, sample_key
              ),
              CONSTRAINT uais_staging_inp_samples_binding_fk FOREIGN KEY (
                cohort_id,
                candidate_git_sha,
                candidate_content_sha,
                deployment_host
              ) REFERENCES public.uais_staging_inp_cohorts (
                cohort_id,
                candidate_git_sha,
                candidate_content_sha,
                deployment_host
              )
            )
          `;
          await transaction.unsafe(cohortsDdl);
          await transaction.unsafe(samplesDdl);
          await transaction`
            CREATE INDEX IF NOT EXISTS uais_staging_inp_expiry_idx
            ON public.uais_staging_inp_samples (expires_at)
          `;
          // Build an independent canonical schema in this connection's
          // temporary namespace. Catalog readback below compares the public
          // tables against PostgreSQL's own normalized representation of this
          // reference DDL, including definitions rather than name-only hints.
          await transaction.unsafe(toStagingInpContractDdl(cohortsDdl));
          await transaction.unsafe(toStagingInpContractDdl(samplesDdl));
          await transaction.unsafe(`
            CREATE INDEX uais_staging_inp_contract_expiry_idx
            ON pg_temp.uais_staging_inp_contract_samples (expires_at)
          `);
          const readback = await transaction`
            WITH target_relations(source, logical_table, relation_oid) AS (VALUES
              ('actual', 'cohorts', to_regclass('public.uais_staging_inp_cohorts')),
              ('actual', 'samples', to_regclass('public.uais_staging_inp_samples')),
              ('expected', 'cohorts', to_regclass('pg_temp.uais_staging_inp_contract_cohorts')),
              ('expected', 'samples', to_regclass('pg_temp.uais_staging_inp_contract_samples'))
            ),
            catalog_columns AS (
              SELECT
                target.source,
                target.logical_table,
                attribute.attnum AS ordinal_position,
                attribute.attname::text AS column_name,
                format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
                attribute.attnotnull AS not_null,
                COALESCE(
                  pg_get_expr(default_record.adbin, default_record.adrelid, true),
                  ''
                ) AS default_expression,
                attribute.attidentity::text AS identity_kind,
                attribute.attgenerated::text AS generated_kind,
                attribute.attcollation::regcollation::text AS collation_name,
                attribute.attstorage::text AS storage_kind,
                attribute.attcompression::text AS compression_kind
              FROM target_relations AS target
              JOIN pg_attribute AS attribute
                ON attribute.attrelid = target.relation_oid
              LEFT JOIN pg_attrdef AS default_record
                ON default_record.adrelid = attribute.attrelid
                AND default_record.adnum = attribute.attnum
              WHERE attribute.attnum > 0
                AND NOT attribute.attisdropped
            ),
            normalized_columns AS (
              SELECT
                source,
                logical_table,
                ordinal_position,
                column_name,
                data_type,
                not_null,
                default_expression,
                identity_kind,
                generated_kind,
                collation_name,
                storage_kind,
                compression_kind
              FROM catalog_columns
            ),
            catalog_relations AS (
              SELECT
                target.source,
                target.logical_table,
                relation.relkind::text AS relation_kind,
                CASE
                  WHEN target.source = 'expected'
                    AND relation.relpersistence = 't'
                  THEN 'p'
                  ELSE relation.relpersistence::text
                END AS normalized_persistence,
                relation.relam,
                relation.relnatts,
                relation.relchecks,
                relation.relhasrules,
                relation.relhastriggers,
                relation.relhassubclass,
                relation.relrowsecurity,
                relation.relforcerowsecurity,
                relation.relispartition,
                relation.relreplident::text AS replica_identity,
                COALESCE(relation.reloptions, ARRAY[]::text[]) AS relation_options
              FROM target_relations AS target
              JOIN pg_class AS relation ON relation.oid = target.relation_oid
            ),
            catalog_constraints AS (
              SELECT
                target.source,
                target.logical_table,
                regexp_replace(
                  replace(replace(replace(
                    constraint_record.conname::text,
                    'uais_staging_inp_contract_expiry_idx',
                    'uais_staging_inp_expiry_idx'
                  ),
                    'uais_staging_inp_contract_samples',
                    'uais_staging_inp_samples'
                  ),
                    'uais_staging_inp_contract_cohorts',
                    'uais_staging_inp_cohorts'
                  ),
                  '(pg_temp(_[0-9]+)?|public)[.]', '', 'g'
                ) AS constraint_name,
                constraint_record.contype::text AS constraint_type,
                constraint_record.convalidated,
                constraint_record.condeferrable,
                constraint_record.condeferred,
                constraint_record.connoinherit,
                constraint_record.confupdtype::text AS foreign_update_action,
                constraint_record.confdeltype::text AS foreign_delete_action,
                constraint_record.confmatchtype::text AS foreign_match_type,
                regexp_replace(
                  replace(replace(replace(
                    pg_get_constraintdef(constraint_record.oid, true),
                    'uais_staging_inp_contract_expiry_idx',
                    'uais_staging_inp_expiry_idx'
                  ),
                    'uais_staging_inp_contract_samples',
                    'uais_staging_inp_samples'
                  ),
                    'uais_staging_inp_contract_cohorts',
                    'uais_staging_inp_cohorts'
                  ),
                  '(pg_temp(_[0-9]+)?|public)[.]', '', 'g'
                ) AS constraint_definition
              FROM target_relations AS target
              JOIN pg_constraint AS constraint_record
                ON constraint_record.conrelid = target.relation_oid
              WHERE constraint_record.contype IN ('p', 'u', 'f', 'c')
            ),
            catalog_indexes AS (
              SELECT
                target.source,
                target.logical_table,
                regexp_replace(
                  replace(replace(replace(
                    index_relation.relname::text,
                    'uais_staging_inp_contract_expiry_idx',
                    'uais_staging_inp_expiry_idx'
                  ),
                    'uais_staging_inp_contract_samples',
                    'uais_staging_inp_samples'
                  ),
                    'uais_staging_inp_contract_cohorts',
                    'uais_staging_inp_cohorts'
                  ),
                  '(pg_temp(_[0-9]+)?|public)[.]', '', 'g'
                ) AS index_name,
                index_record.indisvalid,
                index_record.indisready,
                index_record.indislive,
                index_record.indisunique,
                index_record.indisprimary,
                index_record.indisexclusion,
                index_record.indimmediate,
                index_record.indnkeyatts,
                index_record.indnatts,
                regexp_replace(
                  replace(replace(replace(
                    pg_get_indexdef(index_record.indexrelid, 0, true),
                    'uais_staging_inp_contract_expiry_idx',
                    'uais_staging_inp_expiry_idx'
                  ),
                    'uais_staging_inp_contract_samples',
                    'uais_staging_inp_samples'
                  ),
                    'uais_staging_inp_contract_cohorts',
                    'uais_staging_inp_cohorts'
                  ),
                  '(pg_temp(_[0-9]+)?|public)[.]', '', 'g'
                ) AS index_definition,
                COALESCE(
                  regexp_replace(
                    replace(replace(replace(
                      pg_get_expr(index_record.indpred, index_record.indrelid, true),
                      'uais_staging_inp_contract_expiry_idx',
                      'uais_staging_inp_expiry_idx'
                    ),
                      'uais_staging_inp_contract_samples',
                      'uais_staging_inp_samples'
                    ),
                      'uais_staging_inp_contract_cohorts',
                      'uais_staging_inp_cohorts'
                    ),
                    '(pg_temp(_[0-9]+)?|public)[.]', '', 'g'
                  ),
                  ''
                ) AS predicate_definition,
                COALESCE(
                  regexp_replace(
                    replace(replace(replace(
                      pg_get_expr(index_record.indexprs, index_record.indrelid, true),
                      'uais_staging_inp_contract_expiry_idx',
                      'uais_staging_inp_expiry_idx'
                    ),
                      'uais_staging_inp_contract_samples',
                      'uais_staging_inp_samples'
                    ),
                      'uais_staging_inp_contract_cohorts',
                      'uais_staging_inp_cohorts'
                    ),
                    '(pg_temp(_[0-9]+)?|public)[.]', '', 'g'
                  ),
                  ''
                ) AS expression_definition
              FROM target_relations AS target
              JOIN pg_index AS index_record
                ON index_record.indrelid = target.relation_oid
              JOIN pg_class AS index_relation
                ON index_relation.oid = index_record.indexrelid
            ),
            catalog_internal_triggers AS (
              SELECT
                target.source,
                target.logical_table,
                trigger_record.tgenabled::text AS enabled_mode,
                trigger_record.tgtype,
                trigger_record.tgdeferrable,
                trigger_record.tginitdeferred,
                COALESCE(constraint_record.contype::text, '') AS constraint_type,
                count(*)::int AS trigger_count
              FROM target_relations AS target
              JOIN pg_trigger AS trigger_record
                ON trigger_record.tgrelid = target.relation_oid
              LEFT JOIN pg_constraint AS constraint_record
                ON constraint_record.oid = trigger_record.tgconstraint
              WHERE trigger_record.tgisinternal
              GROUP BY
                target.source,
                target.logical_table,
                trigger_record.tgenabled,
                trigger_record.tgtype,
                trigger_record.tgdeferrable,
                trigger_record.tginitdeferred,
                constraint_record.contype
            ),
            actual_columns AS (
              SELECT
                logical_table, ordinal_position, column_name, data_type,
                not_null, default_expression, identity_kind, generated_kind,
                collation_name, storage_kind, compression_kind
              FROM normalized_columns WHERE source = 'actual'
            ),
            expected_columns AS (
              SELECT
                logical_table, ordinal_position, column_name, data_type,
                not_null, default_expression, identity_kind, generated_kind,
                collation_name, storage_kind, compression_kind
              FROM normalized_columns WHERE source = 'expected'
            ),
            actual_constraints AS (
              SELECT
                logical_table, constraint_name, constraint_type, convalidated,
                condeferrable, condeferred, connoinherit,
                foreign_update_action, foreign_delete_action,
                foreign_match_type, constraint_definition
              FROM catalog_constraints WHERE source = 'actual'
            ),
            expected_constraints AS (
              SELECT
                logical_table, constraint_name, constraint_type, convalidated,
                condeferrable, condeferred, connoinherit,
                foreign_update_action, foreign_delete_action,
                foreign_match_type, constraint_definition
              FROM catalog_constraints WHERE source = 'expected'
            ),
            actual_indexes AS (
              SELECT
                logical_table, index_name, indisvalid, indisready, indislive,
                indisunique, indisprimary, indisexclusion, indimmediate,
                indnkeyatts, indnatts, index_definition,
                predicate_definition, expression_definition
              FROM catalog_indexes WHERE source = 'actual'
            ),
            expected_indexes AS (
              SELECT
                logical_table, index_name, indisvalid, indisready, indislive,
                indisunique, indisprimary, indisexclusion, indimmediate,
                indnkeyatts, indnatts, index_definition,
                predicate_definition, expression_definition
              FROM catalog_indexes WHERE source = 'expected'
            ),
            actual_relations AS (
              SELECT
                logical_table, relation_kind, normalized_persistence, relam,
                relnatts, relchecks, relhasrules, relhastriggers,
                relhassubclass, relrowsecurity, relforcerowsecurity,
                relispartition, replica_identity, relation_options
              FROM catalog_relations WHERE source = 'actual'
            ),
            expected_relations AS (
              SELECT
                logical_table, relation_kind, normalized_persistence, relam,
                relnatts, relchecks, relhasrules, relhastriggers,
                relhassubclass, relrowsecurity, relforcerowsecurity,
                relispartition, replica_identity, relation_options
              FROM catalog_relations WHERE source = 'expected'
            ),
            actual_internal_triggers AS (
              SELECT
                logical_table, enabled_mode, tgtype, tgdeferrable,
                tginitdeferred, constraint_type, trigger_count
              FROM catalog_internal_triggers WHERE source = 'actual'
            ),
            expected_internal_triggers AS (
              SELECT
                logical_table, enabled_mode, tgtype, tgdeferrable,
                tginitdeferred, constraint_type, trigger_count
              FROM catalog_internal_triggers WHERE source = 'expected'
            )
            SELECT (
              (SELECT count(*) = 4 FROM target_relations AS target
                JOIN pg_class AS relation ON relation.oid = target.relation_oid)
              AND NOT EXISTS (
                (SELECT * FROM actual_relations EXCEPT SELECT * FROM expected_relations)
                UNION ALL
                (SELECT * FROM expected_relations EXCEPT SELECT * FROM actual_relations)
              )
              AND NOT EXISTS (
                SELECT 1
                FROM target_relations AS target
                JOIN pg_inherits AS inheritance
                  ON inheritance.inhrelid = target.relation_oid
                  OR inheritance.inhparent = target.relation_oid
              )
              AND NOT EXISTS (
                SELECT 1
                FROM target_relations AS target
                JOIN pg_attribute AS attribute
                  ON attribute.attrelid = target.relation_oid
                WHERE attribute.attisdropped
              )
              AND NOT EXISTS (
                SELECT 1
                FROM target_relations AS target
                JOIN pg_trigger AS trigger_record
                  ON trigger_record.tgrelid = target.relation_oid
                WHERE NOT trigger_record.tgisinternal
              )
              AND NOT EXISTS (
                SELECT 1
                FROM target_relations AS target
                JOIN pg_rewrite AS rewrite_record
                  ON rewrite_record.ev_class = target.relation_oid
              )
              AND NOT EXISTS (
                SELECT 1
                FROM target_relations AS target
                JOIN pg_policy AS policy_record
                  ON policy_record.polrelid = target.relation_oid
              )
              AND NOT EXISTS (
                (SELECT * FROM actual_columns EXCEPT SELECT * FROM expected_columns)
                UNION ALL
                (SELECT * FROM expected_columns EXCEPT SELECT * FROM actual_columns)
              )
              AND NOT EXISTS (
                (SELECT * FROM actual_constraints EXCEPT SELECT * FROM expected_constraints)
                UNION ALL
                (SELECT * FROM expected_constraints EXCEPT SELECT * FROM actual_constraints)
              )
              AND NOT EXISTS (
                (SELECT * FROM actual_indexes EXCEPT SELECT * FROM expected_indexes)
                UNION ALL
                (SELECT * FROM expected_indexes EXCEPT SELECT * FROM actual_indexes)
              )
              AND NOT EXISTS (
                (SELECT * FROM actual_internal_triggers
                  EXCEPT SELECT * FROM expected_internal_triggers)
                UNION ALL
                (SELECT * FROM expected_internal_triggers
                  EXCEPT SELECT * FROM actual_internal_triggers)
              )
            ) AS schema_ready
          `;
          const schemaReady = readback[0]?.schema_ready === true;
          if (!schemaReady) {
            throw new UaisStagingInpStoreError(
              503,
              "staging-inp-schema-readback-failed",
            );
          }
          return {
            status: "ready" as const,
            cohortsTable: true,
            samplesTable: true,
            valuesRedacted: true as const,
          };
        }),
      );
    },

    async persist(sample: UaisStagingInpStoredSample) {
      assertSampleExpiry(sample);
      return withGuardedStagingInpClient(databaseUrl, sqlFactory, async (sql) =>
        sql.begin(async (transaction) => {
          await assertPostgresSourceGuard(transaction);
          await lockPostgresLifecycle(transaction);
          await transaction`
            DELETE FROM public.uais_staging_inp_samples
            WHERE expires_at <= now()
          `;
          await transaction`
            INSERT INTO public.uais_staging_inp_cohorts (
              cohort_id,
              candidate_git_sha,
              candidate_content_sha,
              deployment_host
            ) VALUES (
              ${sample.cohortId},
              ${sample.candidateGitSha},
              ${sample.candidateContentSha},
              ${sample.deploymentHost}
            )
            ON CONFLICT (cohort_id) DO NOTHING
          `;
          const cohort = await selectPostgresCohortForUpdate(
            transaction,
            sample.cohortId,
          );
          assertPostgresCohort(cohort, sample);
          assertOpenCohort(toPostgresCohortRecord(cohort));

          const existing = await transaction`
            SELECT
              candidate_git_sha,
              candidate_content_sha,
              deployment_host,
              role,
              journey,
              viewport_class,
              navigation_type,
              value_ms
            FROM public.uais_staging_inp_samples
            WHERE cohort_id = ${sample.cohortId}
              AND sample_key = ${sample.sampleKey}
            LIMIT 1
          `;
          if (existing.length > 0) {
            assertPostgresSampleIdentity(existing[0], sample);
            await transaction`
              UPDATE public.uais_staging_inp_samples
              SET value_ms = GREATEST(value_ms, ${sample.valueMs})
              WHERE cohort_id = ${sample.cohortId}
                AND candidate_git_sha = ${sample.candidateGitSha}
                AND candidate_content_sha = ${sample.candidateContentSha}
                AND deployment_host = ${sample.deploymentHost}
                AND sample_key = ${sample.sampleKey}
            `;
            return { status: "updated" as const };
          }

          const cohortCount = await transaction`
            SELECT count(*)::int AS count
            FROM public.uais_staging_inp_samples
            WHERE cohort_id = ${sample.cohortId}
              AND candidate_git_sha = ${sample.candidateGitSha}
              AND candidate_content_sha = ${sample.candidateContentSha}
              AND deployment_host = ${sample.deploymentHost}
          `;
          if (Number(cohortCount[0]?.count ?? 0) >= UAIS_STAGING_INP_COHORT_CAP) {
            throw new UaisStagingInpStoreError(
              429,
              "staging-inp-cohort-cap-reached",
            );
          }
          const hourlyCount = await transaction`
            SELECT count(*)::int AS count
            FROM public.uais_staging_inp_samples
            WHERE cohort_id = ${sample.cohortId}
              AND candidate_git_sha = ${sample.candidateGitSha}
              AND candidate_content_sha = ${sample.candidateContentSha}
              AND deployment_host = ${sample.deploymentHost}
              AND role = ${sample.role}
              AND journey = ${sample.journey}
              AND date_trunc('hour', received_at AT TIME ZONE 'UTC') =
                date_trunc(
                  'hour',
                  ${sample.receivedAt}::timestamptz AT TIME ZONE 'UTC'
                )
          `;
          if (Number(hourlyCount[0]?.count ?? 0) >= UAIS_STAGING_INP_HOURLY_ID_CAP) {
            throw new UaisStagingInpStoreError(
              429,
              "staging-inp-hourly-limit-reached",
            );
          }
          await transaction`
            INSERT INTO public.uais_staging_inp_samples (
              cohort_id,
              sample_key,
              candidate_git_sha,
              candidate_content_sha,
              deployment_host,
              role,
              journey,
              viewport_class,
              navigation_type,
              value_ms,
              received_at,
              expires_at
            ) VALUES (
              ${sample.cohortId},
              ${sample.sampleKey},
              ${sample.candidateGitSha},
              ${sample.candidateContentSha},
              ${sample.deploymentHost},
              ${sample.role},
              ${sample.journey},
              ${sample.viewportClass},
              ${sample.navigationType},
              ${sample.valueMs},
              ${sample.receivedAt},
              ${sample.expiresAt}
            )
          `;
          return { status: "stored" as const };
        }),
      );
    },

    async readiness(
      binding: UaisStagingInpBinding,
    ): Promise<UaisStagingInpReadinessReceipt> {
      return withGuardedStagingInpClient(databaseUrl, sqlFactory, async (sql) =>
        sql.begin(async (transaction) => {
          await assertPostgresSourceGuard(transaction);
          await lockPostgresLifecycle(transaction);
          const cohort = await selectPostgresCohortForUpdate(
            transaction,
            binding.cohortId,
          );
          assertPostgresCohort(cohort, binding);
          const record = toPostgresCohortRecord(cohort);
          if (record.state === "purged") {
            throw new UaisStagingInpStoreError(409, "staging-inp-cohort-purged");
          }
          return {
            ...binding,
            state: record.state,
            groups: await aggregatePostgresSamples(transaction, binding),
          };
        }),
      );
    },

    async aggregate(
      binding: UaisStagingInpBinding,
    ): Promise<UaisStagingInpAggregateReceipt> {
      return withGuardedStagingInpClient(databaseUrl, sqlFactory, async (sql) =>
        sql.begin(async (transaction) => {
          await assertPostgresSourceGuard(transaction);
          await lockPostgresLifecycle(transaction);
          const cohort = await selectPostgresCohortForUpdate(
            transaction,
            binding.cohortId,
          );
          assertPostgresCohort(cohort, binding);
          const record = toPostgresCohortRecord(cohort);
          if (record.state === "purged") {
            throw new UaisStagingInpStoreError(409, "staging-inp-cohort-purged");
          }
          if (record.state === "open") {
            await transaction`
              UPDATE public.uais_staging_inp_cohorts
              SET lifecycle_state = 'closed', closed_at = now()
              WHERE cohort_id = ${binding.cohortId}
                AND candidate_git_sha = ${binding.candidateGitSha}
                AND candidate_content_sha = ${binding.candidateContentSha}
                AND deployment_host = ${binding.deploymentHost}
                AND lifecycle_state = 'open'
            `;
          }
          return {
            ...binding,
            state: "closed" as const,
            groups: await aggregatePostgresSamples(transaction, binding),
          };
        }),
      );
    },

    async purge(
      binding: UaisStagingInpBinding,
    ): Promise<UaisStagingInpPurgeReceipt> {
      return withGuardedStagingInpClient(databaseUrl, sqlFactory, async (sql) =>
        sql.begin(async (transaction) => {
          await assertPostgresSourceGuard(transaction);
          await lockPostgresLifecycle(transaction);
          const cohort = await selectPostgresCohortForUpdate(
            transaction,
            binding.cohortId,
          );
          assertPostgresCohort(cohort, binding);
          await transaction`
            UPDATE public.uais_staging_inp_cohorts
            SET lifecycle_state = 'purged',
                closed_at = COALESCE(closed_at, now()),
                purged_at = COALESCE(purged_at, now())
            WHERE cohort_id = ${binding.cohortId}
              AND candidate_git_sha = ${binding.candidateGitSha}
              AND candidate_content_sha = ${binding.candidateContentSha}
              AND deployment_host = ${binding.deploymentHost}
          `;
          const deleted = await transaction`
            DELETE FROM public.uais_staging_inp_samples
            WHERE cohort_id = ${binding.cohortId}
              AND candidate_git_sha = ${binding.candidateGitSha}
              AND candidate_content_sha = ${binding.candidateContentSha}
              AND deployment_host = ${binding.deploymentHost}
            RETURNING 1 AS deleted
          `;
          const remainingForBinding = await countPostgresSamples(
            transaction,
            binding,
          );
          return {
            ...binding,
            state: "purged" as const,
            deletedCount: deleted.length,
            remainingForBinding,
            zeroResidue: remainingForBinding === 0,
          };
        }),
      );
    },

    async readback(
      binding: UaisStagingInpBinding,
    ): Promise<UaisStagingInpReadbackReceipt> {
      return withGuardedStagingInpClient(databaseUrl, sqlFactory, async (sql) =>
        sql.begin(async (transaction) => {
          await assertPostgresSourceGuard(transaction);
          await lockPostgresLifecycle(transaction);
          const cohort = await selectPostgresCohortForUpdate(
            transaction,
            binding.cohortId,
          );
          assertPostgresCohort(cohort, binding);
          return {
            ...binding,
            state: toPostgresCohortRecord(cohort).state,
            remainingForBinding: await countPostgresSamples(transaction, binding),
          };
        }),
      );
    },

    async purgeExpired() {
      return withGuardedStagingInpClient(databaseUrl, sqlFactory, async (sql) =>
        sql.begin(async (transaction) => {
          await assertPostgresSourceGuard(transaction);
          await lockPostgresLifecycle(transaction);
          const deleted = await purgeExpiredPostgresSamples(transaction);
          const remainingExpired = await transaction`
            SELECT count(*)::int AS count
            FROM public.uais_staging_inp_samples
            WHERE expires_at <= now()
          `;
          const remainingExpiredCount = Number(remainingExpired[0]?.count ?? 0);
          return {
            deletedCount: deleted.length,
            remainingExpiredCount,
            zeroResidue: remainingExpiredCount === 0,
            valuesRedacted: true as const,
          };
        }),
      );
    },
  };
}

async function withGuardedStagingInpClient<T>(
  databaseUrl: string | undefined,
  sqlFactory: typeof postgres,
  operation: (sql: ReturnType<typeof postgres>) => Promise<T>,
) {
  if (!databaseUrl) {
    throw new UaisStagingInpStoreError(503, "staging-inp-source-guard-required");
  }
  const sql = sqlFactory(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 10,
  });
  try {
    const guard = await sql`
      SELECT
        environment,
        current_setting('session_replication_role') AS session_replication_role
      FROM public.uais_environment_guard
      WHERE environment = 'isolated-p2-staging-source'
        AND enabled = true
      LIMIT 1
    `;
    if (
      guard.length !== 1 ||
      guard[0]?.session_replication_role !== "origin"
    ) {
      throw new UaisStagingInpStoreError(
        503,
        "staging-inp-source-guard-required",
      );
    }
    return await operation(sql);
  } catch (error) {
    if (error instanceof UaisStagingInpStoreError) throw error;
    throw new UaisStagingInpStoreError(503, "staging-inp-database-unavailable");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function assertPostgresSourceGuard(sql: TransactionSql) {
  const guard = await sql`
    SELECT
      environment,
      current_setting('session_replication_role') AS session_replication_role
    FROM public.uais_environment_guard
    WHERE environment = 'isolated-p2-staging-source'
      AND enabled = true
    LIMIT 1
  `;
  if (
    guard.length !== 1 ||
    guard[0]?.session_replication_role !== "origin"
  ) {
    throw new UaisStagingInpStoreError(503, "staging-inp-source-guard-required");
  }
}

async function lockPostgresLifecycle(sql: TransactionSql) {
  await sql`SELECT pg_advisory_xact_lock(hashtext('uais-staging-inp-v4'))`;
}

function toStagingInpContractDdl(ddl: string) {
  return ddl
    .replace("CREATE TABLE IF NOT EXISTS public.", "CREATE TEMP TABLE ")
    .replaceAll(
      "public.uais_staging_inp_samples",
      "pg_temp.uais_staging_inp_contract_samples",
    )
    .replaceAll(
      "public.uais_staging_inp_cohorts",
      "pg_temp.uais_staging_inp_contract_cohorts",
    )
    .replaceAll(
      "uais_staging_inp_samples",
      "uais_staging_inp_contract_samples",
    )
    .replaceAll(
      "uais_staging_inp_cohorts",
      "uais_staging_inp_contract_cohorts",
    );
}

async function purgeExpiredPostgresSamples(sql: TransactionSql) {
  return sql`
    DELETE FROM public.uais_staging_inp_samples
    WHERE expires_at <= now()
    RETURNING 1 AS deleted
  `;
}

async function selectPostgresCohortForUpdate(
  sql: TransactionSql,
  cohortId: string,
) {
  return sql`
    SELECT
      cohort_id,
      candidate_git_sha,
      candidate_content_sha,
      deployment_host,
      lifecycle_state,
      closed_at,
      purged_at
    FROM public.uais_staging_inp_cohorts
    WHERE cohort_id = ${cohortId}
    FOR UPDATE
  `;
}

async function countPostgresSamples(
  sql: TransactionSql,
  binding: UaisStagingInpBinding,
) {
  const rows = await sql`
    SELECT count(*)::int AS count
    FROM public.uais_staging_inp_samples
    WHERE cohort_id = ${binding.cohortId}
      AND candidate_git_sha = ${binding.candidateGitSha}
      AND candidate_content_sha = ${binding.candidateContentSha}
      AND deployment_host = ${binding.deploymentHost}
  `;
  return Number(rows[0]?.count ?? 0);
}

async function aggregatePostgresSamples(
  sql: TransactionSql,
  binding: UaisStagingInpBinding,
): Promise<UaisStagingInpAggregate[]> {
  const rows = await sql`
    SELECT
      role,
      journey,
      viewport_class,
      count(*)::int AS n,
      percentile_cont(0.75)
        WITHIN GROUP (ORDER BY value_ms)::double precision AS p75_ms
    FROM public.uais_staging_inp_samples
    WHERE cohort_id = ${binding.cohortId}
      AND candidate_git_sha = ${binding.candidateGitSha}
      AND candidate_content_sha = ${binding.candidateContentSha}
      AND deployment_host = ${binding.deploymentHost}
      AND expires_at > now()
    GROUP BY role, journey, viewport_class
    ORDER BY role, journey, viewport_class
  `;
  return rows.map((row) => ({
    role: row.role as UaisStagingInpRole,
    journey: row.journey as UaisStagingInpJourney,
    viewportClass: row.viewport_class as UaisStagingInpViewportClass,
    n: Number(row.n),
    p75Ms: Number(row.p75_ms),
  }));
}

function assertPostgresCohort(
  rows: readonly Record<string, unknown>[],
  binding: UaisStagingInpBinding,
) {
  if (rows.length !== 1) {
    throw new UaisStagingInpStoreError(409, "staging-inp-cohort-missing");
  }
  assertBinding(toPostgresCohortRecord(rows), binding);
}

function toPostgresCohortRecord(
  rows: readonly Record<string, unknown>[],
): UaisStagingInpCohortRecord {
  const row = rows[0] ?? {};
  const state = String(row.lifecycle_state ?? "");
  if (state !== "open" && state !== "closed" && state !== "purged") {
    throw new UaisStagingInpStoreError(503, "staging-inp-cohort-state-invalid");
  }
  return {
    cohortId: String(row.cohort_id ?? ""),
    candidateGitSha: String(row.candidate_git_sha ?? ""),
    candidateContentSha: String(row.candidate_content_sha ?? ""),
    deploymentHost: String(row.deployment_host ?? ""),
    state,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    purgedAt: row.purged_at ? String(row.purged_at) : null,
  };
}

function assertPostgresSampleIdentity(
  row: Record<string, unknown>,
  sample: UaisStagingInpStoredSample,
) {
  if (
    row.candidate_git_sha !== sample.candidateGitSha ||
    row.candidate_content_sha !== sample.candidateContentSha ||
    row.deployment_host !== sample.deploymentHost ||
    row.role !== sample.role ||
    row.journey !== sample.journey ||
    row.viewport_class !== sample.viewportClass ||
    row.navigation_type !== sample.navigationType
  ) {
    throw new UaisStagingInpStoreError(
      409,
      "staging-inp-sample-identity-conflict",
    );
  }
}

function assertSampleExpiry(sample: UaisStagingInpStoredSample) {
  const receivedAt = Date.parse(sample.receivedAt);
  const expiresAt = Date.parse(sample.expiresAt);
  const expectedTtlMs = UAIS_STAGING_INP_TTL_HOURS * 60 * 60 * 1_000;
  if (
    !Number.isFinite(receivedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt - receivedAt !== expectedTtlMs
  ) {
    throw new UaisStagingInpStoreError(
      409,
      "staging-inp-sample-expiry-invalid",
    );
  }
}

function bindingFromSample(sample: UaisStagingInpStoredSample): UaisStagingInpBinding {
  return {
    cohortId: sample.cohortId,
    candidateGitSha: sample.candidateGitSha,
    candidateContentSha: sample.candidateContentSha,
    deploymentHost: sample.deploymentHost,
  };
}

function sameBinding(left: UaisStagingInpBinding, right: UaisStagingInpBinding) {
  return (
    left.cohortId === right.cohortId &&
    left.candidateGitSha === right.candidateGitSha &&
    left.candidateContentSha === right.candidateContentSha &&
    left.deploymentHost === right.deploymentHost
  );
}

function assertBinding(actual: UaisStagingInpBinding, expected: UaisStagingInpBinding) {
  if (!sameBinding(actual, expected)) {
    throw new UaisStagingInpStoreError(409, "staging-inp-cohort-binding-mismatch");
  }
}

function assertOpenCohort(cohort: UaisStagingInpCohortRecord) {
  if (cohort.state === "closed") {
    throw new UaisStagingInpStoreError(409, "staging-inp-cohort-closed");
  }
  if (cohort.state === "purged") {
    throw new UaisStagingInpStoreError(409, "staging-inp-cohort-purged");
  }
}

function assertSameSampleIdentity(
  actual: UaisStagingInpStoredSample,
  expected: UaisStagingInpStoredSample,
) {
  if (
    !sameBinding(actual, expected) ||
    actual.role !== expected.role ||
    actual.journey !== expected.journey ||
    actual.viewportClass !== expected.viewportClass ||
    actual.navigationType !== expected.navigationType
  ) {
    throw new UaisStagingInpStoreError(409, "staging-inp-sample-identity-conflict");
  }
}

function utcHour(value: string) {
  const time = new Date(value);
  time.setUTCMinutes(0, 0, 0);
  return time.toISOString();
}

function aggregateSamples(
  samples: UaisStagingInpStoredSample[],
): UaisStagingInpAggregate[] {
  const groups = new Map<string, UaisStagingInpStoredSample[]>();
  for (const sample of samples) {
    const key = `${sample.role}\u0000${sample.journey}\u0000${sample.viewportClass}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.values()]
    .map((group) => ({
      role: group[0].role,
      journey: group[0].journey,
      viewportClass: group[0].viewportClass,
      n: group.length,
      p75Ms: percentile(group.map((item) => item.valueMs), 0.75),
    }))
    .sort((left, right) =>
      `${left.role}\u0000${left.journey}\u0000${left.viewportClass}`.localeCompare(
        `${right.role}\u0000${right.journey}\u0000${right.viewportClass}`,
      ),
    );
}

function percentile(values: number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}
