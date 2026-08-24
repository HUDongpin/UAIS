import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createStagingInpExpiryPurgeHandler } from "@/lib/server/uais-staging-inp-expiry-route-service";
import { UAIS_STAGING_INP_PROJECT_ID } from "@/lib/observability/uais-staging-inp";

const deploymentHost = "uais-staging-current-team.vercel.app";
const candidateGitSha = "a".repeat(40);

function readyEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: UAIS_STAGING_INP_PROJECT_ID,
    VERCEL_GIT_COMMIT_SHA: candidateGitSha,
    VERCEL_URL: deploymentHost,
    UAIS_DEPLOYMENT_ENV: "staging",
    UAIS_STAGING_INP_RUM_ENABLED: "yes",
    UAIS_P2_STAGING_DATABASE_URL: "postgres://redacted.example.test/uais",
    P2_CANDIDATE_GIT_SHA: candidateGitSha,
    P2_CANDIDATE_CONTENT_SHA: "b".repeat(64),
    UAIS_STAGING_INP_COHORT_ID: `p2-inp-${candidateGitSha}-run1`,
    UAIS_STAGING_INP_HMAC_SECRET: "staging-inp-hmac-secret-fixture-strong",
    UAIS_STAGING_INP_HMAC_KEY_VERSION: "v1",
    UAIS_APP_SESSION_SIGNING_SECRET: "app-session-secret-fixture-at-least-32",
    UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: ["c", "d", "e"]
      .map((value) => value.repeat(64))
      .join(","),
    CRON_SECRET: "staging-inp-expiry-cron-secret-at-least-32",
    ...overrides,
  };
}

function request(secret = "staging-inp-expiry-cron-secret-at-least-32") {
  return new Request(
    `https://${deploymentHost}/api/observability/staging-inp/purge-expired`,
    { headers: { authorization: `Bearer ${secret}` } },
  );
}

describe("staging INP independent expiry purge", () => {
  it("runs only with the exact staging guard and cron secret", async () => {
    const purgeExpired = vi.fn(async () => ({
      cohortsAutoClosed: 2,
      expiredRawSampleRowsDeleted: 8,
      expiredRawSampleRowsRemaining: 0,
      expiredRawSampleRowsZero: true,
      valuesRedacted: true as const,
    }));
    const handler = createStagingInpExpiryPurgeHandler({
      env: readyEnv(),
      purgeExpired,
    });

    const response = await handler(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      target: "uais-staging-inp-expiry-purge",
      status: "PASS",
      cohortsAutoClosed: 2,
      expiredRawSampleRowsDeleted: 8,
      expiredRawSampleRowsRemaining: 0,
      expiredRawSampleRowsZero: true,
      valuesRedacted: true,
    });
    expect(purgeExpired).toHaveBeenCalledOnce();
  });

  it("keeps expiry cleanup available after collection and candidate access are disabled", async () => {
    const purgeExpired = vi.fn(async () => ({
      cohortsAutoClosed: 1,
      expiredRawSampleRowsDeleted: 3,
      expiredRawSampleRowsRemaining: 0,
      expiredRawSampleRowsZero: true,
      valuesRedacted: true as const,
    }));
    const handler = createStagingInpExpiryPurgeHandler({
      env: readyEnv({
        UAIS_STAGING_INP_RUM_ENABLED: "no",
        P2_CANDIDATE_GIT_SHA: undefined,
        P2_CANDIDATE_CONTENT_SHA: undefined,
        UAIS_STAGING_INP_COHORT_ID: undefined,
        UAIS_STAGING_INP_HMAC_SECRET: undefined,
        UAIS_APP_SESSION_SIGNING_SECRET: undefined,
        UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: undefined,
      }),
      purgeExpired,
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(purgeExpired).toHaveBeenCalledOnce();
  });

  it("fails closed for production identity, missing secrets and incorrect authorization", async () => {
    const purgeExpired = vi.fn();
    expect(
      (
        await createStagingInpExpiryPurgeHandler({
          env: readyEnv({ VERCEL_PROJECT_ID: "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA" }),
          purgeExpired,
        })(request())
      ).status,
    ).toBe(404);
    expect(
      (
        await createStagingInpExpiryPurgeHandler({
          env: readyEnv({ CRON_SECRET: undefined }),
          purgeExpired,
        })(request())
      ).status,
    ).toBe(404);
    expect(
      (
        await createStagingInpExpiryPurgeHandler({
          env: readyEnv(),
          purgeExpired,
        })(request("incorrect-but-long-cron-secret-value"))
      ).status,
    ).toBe(401);
    expect(purgeExpired).not.toHaveBeenCalled();
  });

  it("declares the hourly cron only in the staging-specific Vercel config", () => {
    const productionConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const stagingConfig = JSON.parse(readFileSync("vercel.staging.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(productionConfig.crons).toBeUndefined();
    expect(stagingConfig.crons).toContainEqual({
      path: "/api/observability/staging-inp/purge-expired",
      schedule: "17 * * * *",
    });
  });
});
