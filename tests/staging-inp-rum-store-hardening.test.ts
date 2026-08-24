import { describe, expect, it } from "vitest";
import {
  UAIS_STAGING_INP_OPERATOR_HOURLY_ID_CAP,
  UAIS_STAGING_INP_TTL_HOURS,
  type UaisStagingInpBinding,
} from "@/lib/observability/uais-staging-inp";
import {
  createInMemoryUaisStagingInpStore,
  type UaisStagingInpStoredSample,
} from "@/lib/server/uais-staging-inp-store";

const startedAt = new Date("2026-08-24T00:00:00.000Z");
const binding: UaisStagingInpBinding = {
  cohortId: `p2-inp-${"a".repeat(40)}-hardening`,
  candidateGitSha: "a".repeat(40),
  candidateContentSha: "b".repeat(64),
  deploymentHost: "uais-staging-current-team.vercel.app",
  collectorKeyVersion: "v1",
  operatorAllowlistFingerprint: "d".repeat(64),
};

function sample(
  index: number,
  overrides: Partial<UaisStagingInpStoredSample> = {},
): UaisStagingInpStoredSample {
  const receivedAt = overrides.receivedAt ?? startedAt.toISOString();
  return {
    ...binding,
    sampleKey: index.toString(16).padStart(64, "0"),
    metricIdKey: index.toString(16).padStart(64, "f"),
    operatorKey: "1".repeat(64),
    role: "student",
    journey: "student-learning",
    viewportClass: "wide",
    navigationType: "navigate",
    valueMs: 180,
    receivedAt,
    expiresAt: new Date(
      Date.parse(receivedAt) + UAIS_STAGING_INP_TTL_HOURS * 60 * 60 * 1_000,
    ).toISOString(),
    ...overrides,
  };
}

describe("staging INP cohort hardening", () => {
  it("binds a cohort to collector/allowlist fingerprints and counts distinct operators", async () => {
    const store = createInMemoryUaisStagingInpStore({ now: () => startedAt });
    await store.setup(binding);
    await store.persist(sample(1, { operatorKey: "1".repeat(64) }));
    await store.persist(sample(2, { operatorKey: "2".repeat(64) }));
    await store.persist(sample(3, { operatorKey: "3".repeat(64) }));

    await expect(store.readiness(binding)).resolves.toMatchObject({
      state: "open",
      groups: [
        expect.objectContaining({
          n: 3,
          distinctOperatorCount: 3,
        }),
      ],
    });
    await expect(
      store.persist(
        sample(4, { operatorAllowlistFingerprint: "e".repeat(64) }),
      ),
    ).rejects.toMatchObject({ reasonCode: "staging-inp-cohort-binding-mismatch" });
    await expect(
      store.persist(sample(1, { metricIdKey: "9".repeat(64) })),
    ).rejects.toMatchObject({ reasonCode: "staging-inp-sample-identity-conflict" });
  });

  it("makes identical/lower duplicates no-ops and rate-limits increasing updates", async () => {
    const store = createInMemoryUaisStagingInpStore({ now: () => startedAt });
    await store.setup(binding);
    await expect(store.persist(sample(1))).resolves.toEqual({ status: "stored" });
    await expect(store.persist(sample(1, { valueMs: 180 }))).resolves.toEqual({
      status: "unchanged",
    });
    await expect(store.persist(sample(1, { valueMs: 170 }))).resolves.toEqual({
      status: "unchanged",
    });
    const oneSecondLater = new Date(startedAt.getTime() + 1_000).toISOString();
    await expect(
      store.persist(
        sample(1, {
          valueMs: 190,
          receivedAt: oneSecondLater,
          expiresAt: new Date(
            Date.parse(oneSecondLater) + UAIS_STAGING_INP_TTL_HOURS * 60 * 60 * 1_000,
          ).toISOString(),
        }),
      ),
    ).resolves.toEqual({ status: "updated" });
    const tooSoon = new Date(startedAt.getTime() + 1_500).toISOString();
    await expect(
      store.persist(
        sample(1, {
          valueMs: 200,
          receivedAt: tooSoon,
          expiresAt: new Date(
            Date.parse(tooSoon) + UAIS_STAGING_INP_TTL_HOURS * 60 * 60 * 1_000,
          ).toISOString(),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "staging-inp-update-rate-limited" });
  });

  it("caps new metric IDs by operator and UTC hour", async () => {
    const store = createInMemoryUaisStagingInpStore({ now: () => startedAt });
    await store.setup(binding);
    for (let index = 1; index <= UAIS_STAGING_INP_OPERATOR_HOURLY_ID_CAP; index += 1) {
      await store.persist(sample(index));
    }
    await expect(
      store.persist(sample(UAIS_STAGING_INP_OPERATOR_HOURLY_ID_CAP + 1)),
    ).rejects.toMatchObject({
      reasonCode: "staging-inp-operator-hourly-limit-reached",
    });
  });

  it("immutably closes an expired cohort before rejecting new writes and purging raw rows", async () => {
    let clock = startedAt;
    const store = createInMemoryUaisStagingInpStore({ now: () => clock });
    await store.setup(binding);
    clock = new Date(startedAt.getTime() + 24 * 60 * 60 * 1_000);
    await store.setup(binding);
    await store.persist(sample(1));
    clock = new Date(
      startedAt.getTime() + UAIS_STAGING_INP_TTL_HOURS * 60 * 60 * 1_000 + 1,
    );

    await expect(store.persist(sample(2, { receivedAt: clock.toISOString() }))).rejects.toMatchObject({
      reasonCode: "staging-inp-cohort-deadline-reached",
    });
    await expect(store.readback(binding)).resolves.toMatchObject({
      state: "closed",
      rawSampleRowsRemaining: 0,
      cohortTombstoneRetained: true,
    });
    await expect(store.purgeExpired()).resolves.toMatchObject({
      expiredRawSampleRowsRemaining: 0,
      expiredRawSampleRowsZero: true,
    });
  });

  it("names purge evidence as raw-row cleanup while retaining the cohort tombstone", async () => {
    const store = createInMemoryUaisStagingInpStore({ now: () => startedAt });
    await store.setup(binding);
    await store.persist(sample(1));

    await expect(store.purge(binding)).resolves.toMatchObject({
      state: "purged",
      rawSampleRowsDeleted: 1,
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
      cohortTombstoneRetained: true,
    });
    await expect(store.setup(binding)).rejects.toMatchObject({
      reasonCode: "staging-inp-cohort-purged",
    });
  });
});
