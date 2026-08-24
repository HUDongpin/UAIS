import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUaisStagingInpPostgresStore,
  type UaisStagingInpStoredSample,
} from "@/lib/server/uais-staging-inp-store";
import type { UaisStagingInpBinding } from "@/lib/observability/uais-staging-inp";
import {
  authorizeLiveDatabaseTestFile,
  inspectDatabaseTarget,
} from "../scripts/run-db-tests.mjs";

const authorization = await authorizeLiveDatabaseTestFile({
  env: process.env,
  lane: "staging-inp",
  testFile: "tests/staging-inp-rum-postgres-integration.test.ts",
});
if (authorization.exitCode !== 0) {
  throw new Error(`UAIS_DB_TEST ${JSON.stringify(authorization.report)}`);
}
const databaseUrl = authorization.databaseUrl ?? "";

describe("staging INP lifecycle on guarded Postgres", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const candidateGitSha = createHash("sha1").update(suffix).digest("hex");
  const candidateContentSha = createHash("sha256").update(suffix).digest("hex");
  const deploymentHost = `uais-staging-${suffix}.vercel.app`;
  const lifecycleBinding: UaisStagingInpBinding = {
    cohortId: `p2-inp-${candidateGitSha}-it${suffix.slice(0, 12)}`,
    candidateGitSha,
    candidateContentSha,
    deploymentHost,
    collectorKeyVersion: "v1",
    operatorAllowlistFingerprint: createHash("sha256")
      .update(`${suffix}:allowlist`)
      .digest("hex"),
  };
  const expiryBinding: UaisStagingInpBinding = {
    ...lifecycleBinding,
    cohortId: `p2-inp-${candidateGitSha}-ex${suffix.slice(0, 12)}`,
  };
  // The store keeps its staging-adapter key, but the value has only one
  // external source: the fully guarded UAIS_DB_TEST_DATABASE_URL above.
  const storeEnv = { UAIS_P2_STAGING_DATABASE_URL: databaseUrl };
  const store = createUaisStagingInpPostgresStore({ env: storeEnv });
  let guardApproved = false;

  beforeAll(async () => {
    const inspection = await inspectDatabaseTarget({
      databaseUrl: databaseUrl!,
    });
    if (inspection.approved !== true) {
      throw new Error(
        "isolated-uais-db-test and isolated-p2-staging-source guard rows required",
      );
    }
    guardApproved = true;
    await store.setup(lifecycleBinding);
    await store.setup(expiryBinding);
  }, 60_000);

  afterAll(async () => {
    if (!guardApproved) return;
    const inspection = await inspectDatabaseTarget({
      databaseUrl: databaseUrl!,
    });
    if (inspection.approved !== true) return;
    const sql = postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
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
        return;
      }
      for (const binding of [lifecycleBinding, expiryBinding]) {
        await sql`
          DELETE FROM public.uais_staging_inp_samples
          WHERE cohort_id = ${binding.cohortId}
            AND candidate_git_sha = ${binding.candidateGitSha}
            AND candidate_content_sha = ${binding.candidateContentSha}
            AND deployment_host = ${binding.deploymentHost}
        `;
        await sql`
          DELETE FROM public.uais_staging_inp_cohorts
          WHERE cohort_id = ${binding.cohortId}
            AND candidate_git_sha = ${binding.candidateGitSha}
            AND candidate_content_sha = ${binding.candidateContentSha}
            AND deployment_host = ${binding.deploymentHost}
        `;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 60_000);

  it("persists, deduplicates, reads without closing, finalizes and purges exactly", async () => {
    const receivedAt = new Date();
    const sample = createSample(lifecycleBinding, {
      sampleKey: createHash("sha256").update(`${suffix}:one`).digest("hex"),
      receivedAt,
      valueMs: 140,
    });

    await expect(store.persist(sample)).resolves.toEqual({ status: "stored" });
    const updatedAt = new Date(receivedAt.getTime() + 1_000);
    await expect(
      store.persist({
        ...sample,
        valueMs: 190,
        receivedAt: updatedAt.toISOString(),
        expiresAt: new Date(
          updatedAt.getTime() + 48 * 60 * 60 * 1_000,
        ).toISOString(),
      }),
    ).resolves.toEqual({
      status: "updated",
    });
    await expect(store.readiness(lifecycleBinding)).resolves.toMatchObject({
      state: "open",
      groups: [{ n: 1, p75Ms: 190 }],
    });
    await expect(store.aggregate(lifecycleBinding)).resolves.toMatchObject({
      state: "closed",
      groups: [{ n: 1, p75Ms: 190 }],
    });
    await expect(
      store.persist(
        createSample(lifecycleBinding, {
          sampleKey: createHash("sha256").update(`${suffix}:two`).digest("hex"),
          receivedAt,
          valueMs: 170,
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "staging-inp-cohort-closed" });
    await expect(store.purge(lifecycleBinding)).resolves.toMatchObject({
      state: "purged",
      rawSampleRowsDeleted: 1,
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
    });
    await expect(store.readback(lifecycleBinding)).resolves.toMatchObject({
      state: "purged",
      rawSampleRowsRemaining: 0,
    });
  });

  it("rejects samples from before cohort setup and keeps expiry cleanup independently callable", async () => {
    const receivedAt = new Date(Date.now() - 72 * 60 * 60 * 1_000);
    await expect(
      store.persist(
        createSample(expiryBinding, {
          sampleKey: createHash("sha256")
            .update(`${suffix}:expired`)
            .digest("hex"),
          receivedAt,
          valueMs: 160,
        }),
      ),
    ).rejects.toMatchObject({
      reasonCode: "staging-inp-sample-outside-cohort-window",
    });
    await expect(store.readback(expiryBinding)).resolves.toMatchObject({
      state: "open",
      rawSampleRowsRemaining: 0,
    });
    await expect(store.purgeExpired()).resolves.toMatchObject({
      expiredRawSampleRowsDeleted: expect.any(Number),
      expiredRawSampleRowsRemaining: 0,
      expiredRawSampleRowsZero: true,
    });
    await expect(store.readback(expiryBinding)).resolves.toMatchObject({
      state: "open",
      rawSampleRowsRemaining: 0,
    });
    await expect(store.purge(expiryBinding)).resolves.toMatchObject({
      state: "purged",
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
    });
  });
});

function createSample(
  binding: UaisStagingInpBinding,
  input: { sampleKey: string; receivedAt: Date; valueMs: number },
): UaisStagingInpStoredSample {
  return {
    ...binding,
    sampleKey: input.sampleKey,
    metricIdKey: createHash("sha256")
      .update(`${input.sampleKey}:metric`)
      .digest("hex"),
    operatorKey: createHash("sha256")
      .update(`${binding.cohortId}:operator`)
      .digest("hex"),
    role: "teacher",
    journey: "teacher-home",
    viewportClass: "wide",
    navigationType: "navigate",
    valueMs: input.valueMs,
    receivedAt: input.receivedAt.toISOString(),
    expiresAt: new Date(
      input.receivedAt.getTime() + 48 * 60 * 60 * 1_000,
    ).toISOString(),
  };
}
