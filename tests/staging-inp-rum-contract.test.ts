import { describe, expect, it } from "vitest";
import {
  UAIS_STAGING_INP_PROJECT_ID,
  classifyUaisStagingInpJourney,
  parseUaisStagingInpPayload,
} from "@/lib/observability/uais-staging-inp";
import {
  getUaisStagingInpBinding,
  getUaisStagingInpGuard,
} from "@/lib/server/uais-staging-inp-runtime";
import {
  createInMemoryUaisStagingInpStore,
  type UaisStagingInpStoredSample,
} from "@/lib/server/uais-staging-inp-store";

const candidateGitSha = "a".repeat(40);
const candidateContentSha = "b".repeat(64);
const deploymentHost = "uais-staging-current-team.vercel.app";
const hmacSecret = "staging-inp-hmac-secret-fixture-strong";
const cohortId = `p2-inp-${candidateGitSha}-run1`;

function readyEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: UAIS_STAGING_INP_PROJECT_ID,
    VERCEL_GIT_COMMIT_SHA: candidateGitSha,
    VERCEL_URL: deploymentHost,
    UAIS_DEPLOYMENT_ENV: "staging",
    UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
    UAIS_STAGING_INP_RUM_ENABLED: "yes",
    UAIS_P2_STAGING_DATABASE_URL: "postgres://redacted.example.test/uais",
    NEON_PROJECT_ID: "neon-staging-project-fixture",
    P2_CANDIDATE_GIT_SHA: candidateGitSha,
    P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
    UAIS_STAGING_INP_COHORT_ID: cohortId,
    UAIS_STAGING_INP_HMAC_SECRET: hmacSecret,
    UAIS_STAGING_INP_HMAC_KEY_VERSION: "v1",
    UAIS_APP_SESSION_SIGNING_SECRET: "app-session-secret-fixture-at-least-32",
    CRON_SECRET: "staging-expiry-cron-secret-fixture-at-least-32",
    P2_VERCEL_PROTECTION_BYPASS_SECRET:
      "staging-protection-bypass-fixture-at-least-32",
    UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: ["c", "d", "e"]
      .map((value) => value.repeat(64))
      .join(","),
    ...overrides,
  };
}

describe("isolated staging INP RUM contract", () => {
  it("binds runtime enablement to the final Git SHA, content SHA and immutable Vercel host", () => {
    const env = readyEnv();

    expect(getUaisStagingInpGuard(env, candidateContentSha)).toEqual({
      enabled: true,
      reasons: [],
    });
    expect(getUaisStagingInpBinding(env, candidateContentSha)).toEqual({
      cohortId,
      candidateGitSha,
      candidateContentSha,
      deploymentHost,
      collectorKeyVersion: "v1",
      operatorAllowlistFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    for (const [name, value, reason] of [
      ["P2_CANDIDATE_GIT_SHA", "d".repeat(40), "candidate-git-sha-mismatch"],
      ["P2_CANDIDATE_CONTENT_SHA", "main", "candidate-content-sha-invalid"],
      [
        "P2_CANDIDATE_CONTENT_SHA",
        "c".repeat(64),
        "candidate-content-sha-mismatch",
      ],
      ["VERCEL_URL", "staging.uais.top", "immutable-deployment-host-invalid"],
    ] as const) {
      const result = getUaisStagingInpGuard(
        readyEnv({ [name]: value }),
        candidateContentSha,
      );
      expect(result.enabled).toBe(false);
      expect(result.reasons).toContain(reason);
    }
  });

  it("rejects production identity and stays disabled without explicit staging opt-in", () => {
    expect(
      getUaisStagingInpGuard(
        readyEnv({
          VERCEL_PROJECT_ID: "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA",
          UAIS_DEPLOYMENT_ENV: "production",
          UAIS_STAGING_INP_RUM_ENABLED: undefined,
        }),
        candidateContentSha,
      ),
    ).toEqual(
      expect.objectContaining({
        enabled: false,
        reasons: expect.arrayContaining([
          "isolated-staging-project-mismatch",
          "production-project-rejected",
          "staging-deployment-marker-missing",
          "explicit-opt-in-missing",
        ]),
      }),
    );
  });

  it.each([
    [
      "disabled group mode",
      { UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off" },
      "staging-groups-mode-required",
    ],
    [
      "missing staging database identity",
      { NEON_PROJECT_ID: undefined },
      "staging-database-identity-missing",
    ],
    [
      "production database identity",
      { NEON_PROJECT_ID: "late-sunset-59152574" },
      "production-database-identity-rejected",
    ],
    [
      "missing expiry credential",
      { CRON_SECRET: undefined },
      "cron-secret-missing-or-weak",
    ],
    [
      "missing protection credential",
      { P2_VERCEL_PROTECTION_BYPASS_SECRET: undefined },
      "protection-bypass-secret-missing-or-weak",
    ],
    [
      "reused expiry credential",
      { CRON_SECRET: hmacSecret },
      "staging-secret-reuse-rejected",
    ],
  ] as const)("fails closed for %s", (_label, override, reason) => {
    expect(getUaisStagingInpGuard(readyEnv(override), candidateContentSha)).toEqual(
      expect.objectContaining({
        enabled: false,
        reasons: expect.arrayContaining([reason]),
      }),
    );
  });

  it("maps only fixed identifier-free hard-load journeys and accepts exactly four scalars", () => {
    expect(classifyUaisStagingInpJourney("/learning")).toBe("student-learning");
    expect(classifyUaisStagingInpJourney("/learning/chatroom")).toBe(
      "student-chatroom",
    );
    expect(
      classifyUaisStagingInpJourney("/teaching/courses/course-private/activities"),
    ).toBe("teacher-activities");
    expect(classifyUaisStagingInpJourney("/learning?student=private")).toBeNull();

    expect(
      parseUaisStagingInpPayload({
        id: "v4-unique-metric-id",
        viewportClass: "wide",
        navigationType: "navigate",
        valueMs: 183,
      }),
    ).toEqual({
      id: "v4-unique-metric-id",
      viewportClass: "wide",
      navigationType: "navigate",
      valueMs: 183,
    });
    expect(
      parseUaisStagingInpPayload({
        id: "v4-unique-metric-id",
        viewportClass: "wide",
        navigationType: "navigate",
        valueMs: 183,
        journey: "teacher-home",
      }),
    ).toBeNull();
  });

  it("deduplicates a metric identity, closes the aggregate and purges to zero residue", async () => {
    const binding = getUaisStagingInpBinding(readyEnv(), candidateContentSha);
    expect(binding).not.toBeNull();
    if (!binding) return;
    const clock = new Date("2026-08-24T12:00:00.000Z");
    const store = createInMemoryUaisStagingInpStore({ now: () => clock });
    const sample: UaisStagingInpStoredSample = {
      ...binding,
      sampleKey: "e".repeat(64),
      metricIdKey: "d".repeat(64),
      operatorKey: "1".repeat(64),
      role: "teacher",
      journey: "teacher-home",
      viewportClass: "wide",
      navigationType: "navigate",
      valueMs: 150,
      receivedAt: clock.toISOString(),
      expiresAt: "2026-08-26T12:00:00.000Z",
    };

    await store.setup(binding);
    await expect(store.persist(sample)).resolves.toEqual({ status: "stored" });
    await expect(store.persist({
      ...sample,
      valueMs: 190,
      receivedAt: "2026-08-24T12:00:01.000Z",
      expiresAt: "2026-08-26T12:00:01.000Z",
    })).resolves.toEqual({
      status: "updated",
    });
    await expect(store.aggregate(binding)).resolves.toEqual(
      expect.objectContaining({
        state: "closed",
        groups: [
          expect.objectContaining({
            role: "teacher",
            journey: "teacher-home",
            viewportClass: "wide",
            n: 1,
            p75Ms: 190,
          }),
        ],
      }),
    );
    await expect(store.persist({ ...sample, sampleKey: "f".repeat(64) })).rejects.toMatchObject({
      reasonCode: "staging-inp-cohort-closed",
    });
    await expect(store.purge(binding)).resolves.toEqual(
      expect.objectContaining({
        state: "purged",
        rawSampleRowsDeleted: 1,
        rawSampleRowsRemaining: 0,
        rawSampleRowsZero: true,
        cohortTombstoneRetained: true,
      }),
    );
    await expect(store.readback(binding)).resolves.toEqual(
      expect.objectContaining({
        state: "purged",
        rawSampleRowsRemaining: 0,
        cohortTombstoneRetained: true,
      }),
    );
  });

  it("requires a one-use cohort ID bound to the candidate Git SHA", () => {
    expect(
      getUaisStagingInpGuard(
        readyEnv({ UAIS_STAGING_INP_COHORT_ID: "p2-inp-current-candidate" }),
        candidateContentSha,
      ).reasons,
    ).toContain("cohort-id-not-candidate-bound");
    expect(
      getUaisStagingInpGuard(
        readyEnv({
          UAIS_STAGING_INP_COHORT_ID: `p2-inp-${"d".repeat(40)}-run1`,
        }),
        candidateContentSha,
      ).reasons,
    ).toContain("cohort-id-not-candidate-bound");
  });

  it("allows a later candidate to use its own SHA-bound cohort after purge", async () => {
    const clock = new Date("2026-08-24T12:00:00.000Z");
    const store = createInMemoryUaisStagingInpStore({ now: () => clock });
    const firstBinding = getUaisStagingInpBinding(readyEnv(), candidateContentSha);
    expect(firstBinding).not.toBeNull();
    if (!firstBinding) return;
    const firstSample: UaisStagingInpStoredSample = {
      ...firstBinding,
      sampleKey: "1".repeat(64),
      metricIdKey: "3".repeat(64),
      operatorKey: "1".repeat(64),
      role: "teacher",
      journey: "teacher-home",
      viewportClass: "wide",
      navigationType: "navigate",
      valueMs: 180,
      receivedAt: clock.toISOString(),
      expiresAt: "2026-08-26T12:00:00.000Z",
    };
    await store.setup(firstBinding);
    await store.persist(firstSample);
    await store.purge(firstBinding);

    const nextGitSha = "d".repeat(40);
    const nextBinding = {
      ...firstBinding,
      cohortId: `p2-inp-${nextGitSha}-run1`,
      candidateGitSha: nextGitSha,
      candidateContentSha: "e".repeat(64),
      deploymentHost: "uais-staging-next-team.vercel.app",
    };
    await store.setup(nextBinding);
    await expect(
      store.persist({
        ...firstSample,
        ...nextBinding,
        sampleKey: "2".repeat(64),
      }),
    ).resolves.toEqual({ status: "stored" });
  });
});
