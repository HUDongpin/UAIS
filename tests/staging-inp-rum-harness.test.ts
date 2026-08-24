import { describe, expect, it, vi } from "vitest";
import { UAIS_STAGING_INP_PROJECT_ID } from "@/lib/observability/uais-staging-inp";
import type { UaisStagingInpBinding } from "@/lib/observability/uais-staging-inp";
import { runP2StagingInpLifecycle } from "../scripts/p2-staging-inp-rum.mjs";

const candidateGitSha = "a".repeat(40);
const candidateContentSha = "b".repeat(64);
const deploymentHost = "uais-staging-current-team.vercel.app";
const cohortId = `p2-inp-${candidateGitSha}-run1`;

function readyEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: UAIS_STAGING_INP_PROJECT_ID,
    VERCEL_GIT_COMMIT_SHA: candidateGitSha,
    VERCEL_URL: deploymentHost,
    P2_IMMUTABLE_DEPLOYMENT_URL: `https://${deploymentHost}`,
    UAIS_DEPLOYMENT_BASE_URL: `https://${deploymentHost}`,
    UAIS_DEPLOYMENT_ENV: "staging",
    UAIS_STAGING_INP_RUM_ENABLED: "yes",
    UAIS_P2_STAGING_DATABASE_URL: "postgres://redacted.example.test/uais",
    P2_CANDIDATE_GIT_SHA: candidateGitSha,
    P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
    UAIS_STAGING_INP_COHORT_ID: cohortId,
    UAIS_STAGING_INP_HMAC_SECRET: "staging-inp-hmac-secret-fixture-strong",
    UAIS_APP_SESSION_SIGNING_SECRET: "app-session-secret-fixture-at-least-32",
    UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: "c".repeat(64),
    ...overrides,
  };
}

function passingGroups() {
  const groups = [];
  for (const journey of ["student-learning", "student-chatroom"] as const) {
    for (const viewportClass of ["compact", "wide"] as const) {
      groups.push({ role: "student" as const, journey, viewportClass, n: 30, p75Ms: 190 });
    }
  }
  for (const journey of [
    "teacher-home",
    "teacher-course-settings",
    "teacher-activities",
    "teacher-submissions",
  ] as const) {
    for (const viewportClass of ["compact", "wide"] as const) {
      groups.push({ role: "teacher" as const, journey, viewportClass, n: 30, p75Ms: 195 });
    }
  }
  return groups;
}

describe("staging INP lifecycle harness", () => {
  it("returns BLOCKED_ENV without creating a store unless live approval is explicit", async () => {
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: ["--action", "setup"],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining([
        "live-execution-flag-required",
        "owner-approval-flag-required",
      ]),
      valuesRedacted: true,
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("rejects mutable aliases and confirmation mismatches before creating a store", async () => {
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: [
        "--live",
        "--approved",
        "--action",
        "finalize",
        "--cohort",
        cohortId,
        "--confirm-close",
        "another-cohort",
      ],
      env: readyEnv({ UAIS_DEPLOYMENT_BASE_URL: "https://staging.uais.top" }),
      verifiedContentSha: candidateContentSha,
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining([
        "deployment-base-url-not-exact-immutable-origin",
        "finalize-confirmation-mismatch",
      ]),
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("finalizes all 12 groups and always purges to a separate zero-residue readback", async () => {
    const aggregate = vi.fn(async (binding) => ({
      ...binding,
      state: "closed" as const,
      groups: passingGroups(),
    }));
    const purge = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      deletedCount: 360,
      remainingForBinding: 0,
      zeroResidue: true,
    }));
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      remainingForBinding: 0,
    }));
    const result = await runP2StagingInpLifecycle({
      argv: [
        "--live",
        "--approved",
        "--action",
        "finalize",
        "--cohort",
        cohortId,
        "--confirm-close",
        cohortId,
      ],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore: () => ({ aggregate, purge, readback }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      status: "PASS",
      evidenceClass: "bounded-current-sha-isolated-staging-rum",
      threshold: {
        requiredGroups: 12,
        passingGroups: 12,
        minimumSamplesPerGroup: 30,
        maximumP75Ms: 200,
      },
      cleanup: {
        state: "purged",
        remainingForBinding: 0,
        zeroResidue: true,
      },
      productionFieldInpProven: false,
    });
    expect(aggregate).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it("reports a threshold failure but still purges and reads back zero residue", async () => {
    const groups = passingGroups();
    groups[0] = { ...groups[0], n: 29, p75Ms: 240 };
    const purge = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      deletedCount: 359,
      remainingForBinding: 0,
      zeroResidue: true,
    }));
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      remainingForBinding: 0,
    }));
    const result = await runP2StagingInpLifecycle({
      argv: [
        "--live",
        "--approved",
        "--action",
        "finalize",
        "--cohort",
        cohortId,
        "--confirm-close",
        cohortId,
      ],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore: () => ({
        aggregate: async (binding: UaisStagingInpBinding) => ({
          ...binding,
          state: "closed" as const,
          groups,
        }),
        purge,
        readback,
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({
      status: "FAIL",
      threshold: { passingGroups: 11 },
      cleanup: { zeroResidue: true, remainingForBinding: 0 },
      productionFieldInpProven: false,
    });
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it("still attempts an independent readback when finalize cleanup purge fails", async () => {
    const purge = vi.fn(async () => {
      throw new Error("fixture purge failure");
    });
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "closed" as const,
      remainingForBinding: 360,
    }));
    const result = await runP2StagingInpLifecycle({
      argv: [
        "--live",
        "--approved",
        "--action",
        "finalize",
        "--cohort",
        cohortId,
        "--confirm-close",
        cohortId,
      ],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore: () => ({
        aggregate: async (binding: UaisStagingInpBinding) => ({
          ...binding,
          state: "closed" as const,
          groups: passingGroups(),
        }),
        purge,
        readback,
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({
      status: "FAIL",
      failureCode: "staging-inp-finalize-or-cleanup-failed",
      cleanup: {
        state: "closed",
        remainingForBinding: 360,
        zeroResidue: false,
      },
    });
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it("keeps CLI expiry cleanup available after collection credentials are removed", async () => {
    const purgeExpired = vi.fn(async () => ({
      deletedCount: 7,
      remainingExpiredCount: 0,
      zeroResidue: true,
      valuesRedacted: true as const,
    }));
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "purge-expired"],
      env: readyEnv({
        P2_IMMUTABLE_DEPLOYMENT_URL: undefined,
        UAIS_DEPLOYMENT_BASE_URL: undefined,
        UAIS_STAGING_INP_RUM_ENABLED: undefined,
        P2_CANDIDATE_GIT_SHA: undefined,
        P2_CANDIDATE_CONTENT_SHA: undefined,
        UAIS_STAGING_INP_COHORT_ID: undefined,
        UAIS_STAGING_INP_HMAC_SECRET: undefined,
        UAIS_APP_SESSION_SIGNING_SECRET: undefined,
        UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: undefined,
      }),
      verifiedContentSha: candidateContentSha,
      createStore: () => ({ purgeExpired }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      status: "PASS",
      evidenceClass: "isolated-staging-expiry-cleanup",
      candidateBinding: null,
      expiry: {
        deletedCount: 7,
        remainingExpiredCount: 0,
        zeroResidue: true,
      },
    });
    expect(purgeExpired).toHaveBeenCalledOnce();
  });
});
