import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UAIS_STAGING_INP_PROJECT_ID } from "@/lib/observability/uais-staging-inp";
import type { UaisStagingInpBinding } from "@/lib/observability/uais-staging-inp";
import {
  readSecureFixedFileForTest,
  runP2StagingInpLifecycle,
} from "../scripts/p2-staging-inp-rum.mjs";

const candidateGitSha = "a".repeat(40);
const candidateContentSha = "b".repeat(64);
const deploymentHost = "uais-staging-current-team.vercel.app";
const deploymentId = "dpl_AbCdEf0123456789Candidate";
const cohortId = `p2-inp-${candidateGitSha}-run1`;
const nowIso = "2026-08-28T03:00:00.000Z";
const measurementStartedAt = "2026-08-28T02:50:00.000Z";
const measurementCompletedAt = "2026-08-28T02:59:00.000Z";
const accountCleanupVerifiedAt = "2026-08-28T02:59:30.000Z";
const distributionSignatureDomain =
  "UAIS-STAGING-INP-EXACT-DISTRIBUTION-SOURCE-V1\n";
const collectorKeyPair = generateKeyPairSync("ed25519");
const collectorPrivateKeyPem = collectorKeyPair.privateKey.export({
  format: "pem",
  type: "pkcs8",
}) as string;
const collectorPublicKeySpkiDer = collectorKeyPair.publicKey.export({
  format: "der",
  type: "spki",
});
const collectorPublicKeySpkiSha256 = sha256(collectorPublicKeySpkiDer);
const collectorKeyId = `rum-field-data-collector-${collectorPublicKeySpkiSha256.slice(0, 16)}`;

function readyEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: UAIS_STAGING_INP_PROJECT_ID,
    VERCEL_GIT_COMMIT_SHA: candidateGitSha,
    VERCEL_DEPLOYMENT_ID: deploymentId,
    VERCEL_URL: deploymentHost,
    P2_IMMUTABLE_DEPLOYMENT_URL: `https://${deploymentHost}`,
    P2_IMMUTABLE_DEPLOYMENT_ID: deploymentId,
    UAIS_DEPLOYMENT_BASE_URL: `https://${deploymentHost}`,
    UAIS_DEPLOYMENT_ENV: "staging",
    UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
    UAIS_STAGING_INP_RUM_ENABLED: "yes",
    UAIS_P2_STAGING_DATABASE_URL: "postgres://redacted.example.test/uais",
    NEON_PROJECT_ID: "neon-staging-project-fixture",
    P2_CANDIDATE_GIT_SHA: candidateGitSha,
    P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
    UAIS_STAGING_INP_COHORT_ID: cohortId,
    UAIS_STAGING_INP_HMAC_SECRET: "staging-inp-hmac-secret-fixture-strong",
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

function passingGroups() {
  const groups = [];
  for (const journey of ["student-learning", "student-chatroom"] as const) {
    for (const viewportClass of ["compact", "wide"] as const) {
      groups.push({
        role: "student" as const,
        journey,
        viewportClass,
        n: 30,
        distinctOperatorCount: 3,
        p75Ms: 180,
      });
    }
  }
  for (const journey of [
    "teacher-home",
    "teacher-course-settings",
    "teacher-activities",
    "teacher-submissions",
  ] as const) {
    for (const viewportClass of ["compact", "wide"] as const) {
      groups.push({
        role: "teacher" as const,
        journey,
        viewportClass,
        n: 30,
        distinctOperatorCount: 3,
        p75Ms: 190,
      });
    }
  }
  return groups;
}

function passingDistributionGroups() {
  return passingGroups().map((group) => ({
    role: group.role,
    journey: group.journey,
    viewportClass: group.viewportClass,
    sampleCount: group.n,
    distinctOperatorCount: group.distinctOperatorCount,
    distinctAdultHumanCount: 3,
    p75Ms: group.p75Ms,
    histogram:
      group.role === "student"
        ? [
            { valueMs: 100, count: 7 },
            { valueMs: 150, count: 15 },
            { valueMs: 190, count: 8 },
          ]
        : [
            { valueMs: 120, count: 8 },
            { valueMs: 160, count: 14 },
            { valueMs: 200, count: 8 },
          ],
  }));
}

function collectorEvidence(
  overrides: {
    groups?: ReturnType<typeof passingDistributionGroups>;
    payload?: Record<string, unknown>;
  } = {},
) {
  const env = readyEnv();
  const operatorAccountHashes = env.UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES!.split(",").sort();
  const operatorFingerprints = operatorAccountHashes.map((value) =>
    sha256(`uais-staging-inp-operator:v1\u0000${value}`),
  );
  const operatorAllowlistSha256 = sha256(canonicalJson(operatorFingerprints));
  const payload = {
    schemaVersion: 1,
    kind: "uais-staging-inp-exact-distribution-source",
    executionClass: "real-user",
    candidateGitSha,
    candidateContentSha256: candidateContentSha,
    projectId: UAIS_STAGING_INP_PROJECT_ID,
    deploymentId,
    deploymentHost,
    runId: cohortId,
    cohortId,
    collectorKeyVersion: "v1",
    collectorKeyId,
    collectorPublicKeySpkiSha256,
    operatorAllowlistSha256,
    operatorFingerprints,
    measurementStartedAt,
    measurementCompletedAt,
    issuedAt: accountCleanupVerifiedAt,
    accountMappingDigestSha256: "f".repeat(64),
    sourceReportSha256: "1".repeat(64),
    percentileAlgorithm: "postgresql-percentile-cont-linear-interpolation-v1",
    accountCleanup: {
      accountMappingsRemaining: 0,
      temporaryAccountsRemaining: 0,
      verifiedAt: accountCleanupVerifiedAt,
    },
    groups: overrides.groups ?? passingDistributionGroups(),
    ...overrides.payload,
  };
  const payloadJson = canonicalJson(payload);
  const payloadSha256 = sha256(payloadJson);
  const signatureBase64 = signBytes(
    null,
    Buffer.from(`${distributionSignatureDomain}${payloadJson}`),
    collectorKeyPair.privateKey,
  ).toString("base64");
  return {
    distributionSource: {
      payload,
      signature: {
        algorithm: "Ed25519",
        keyId: collectorKeyId,
        payloadSha256,
        signatureBase64,
      },
    },
    privateKeyPem: collectorPrivateKeyPem,
    now: () => new Date(nowIso),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function secureFileIoFixture(input: {
  path: string;
  content: Buffer;
  beforeSize?: bigint;
  openedSize?: bigint;
  afterSize?: bigint;
  afterMtimeNs?: bigint;
  afterCtimeNs?: bigint;
}) {
  const fileMode = 0o100600n;
  const parentMode = 0o040700n;
  const beforeSize = input.beforeSize ?? BigInt(input.content.length);
  const openedSize = input.openedSize ?? beforeSize;
  const afterSize = input.afterSize ?? openedSize;
  const before = fakeStat({ mode: fileMode, size: beforeSize, mtimeNs: 10n, ctimeNs: 20n });
  const opened = fakeStat({ mode: fileMode, size: openedSize, mtimeNs: 10n, ctimeNs: 20n });
  const after = fakeStat({
    mode: fileMode,
    size: afterSize,
    mtimeNs: input.afterMtimeNs ?? 10n,
    ctimeNs: input.afterCtimeNs ?? 20n,
  });
  let statCalls = 0;
  let maximumRequestedBytes = 0;
  const close = vi.fn(async () => undefined);
  const io = {
    lstat: vi.fn(async (path: string) =>
      path === input.path
        ? before
        : fakeStat({
            mode: parentMode,
            size: 0n,
            mtimeNs: 1n,
            ctimeNs: 1n,
            directory: true,
          }),
    ),
    open: vi.fn(async () => ({
      stat: vi.fn(async () => (statCalls++ === 0 ? opened : after)),
      read: vi.fn(
        async (buffer: Buffer, offset: number, length: number, position: number) => {
          maximumRequestedBytes = Math.max(maximumRequestedBytes, length);
          const available = Math.max(0, input.content.length - position);
          const bytesRead = Math.min(length, available);
          input.content.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead, buffer };
        },
      ),
      close,
    })),
  };
  return { close, io, maximumRequestedBytes: () => maximumRequestedBytes };
}

function fakeStat(input: {
  mode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  directory?: boolean;
}) {
  return {
    dev: 1n,
    ino: 2n,
    mode: input.mode,
    size: input.size,
    mtimeNs: input.mtimeNs,
    ctimeNs: input.ctimeNs,
    isDirectory: () => input.directory === true,
    isFile: () => input.directory !== true,
    isSymbolicLink: () => false,
  };
}

describe("staging INP lifecycle harness", () => {
  it.each([
    { label: "distribution source", path: "/secure/rum-source.json", maximumBytes: 64 },
    { label: "collector private key", path: "/secure/rum-key.pem", maximumBytes: 64 },
  ])("fails closed on a same-length in-place rewrite of the fixed $label", async ({
    path,
    maximumBytes,
  }) => {
    const fixture = secureFileIoFixture({
      path,
      content: Buffer.from("same"),
      afterMtimeNs: 11n,
      afterCtimeNs: 21n,
    });

    await expect(
      readSecureFixedFileForTest({ path, maximumBytes, io: fixture.io }),
    ).rejects.toThrow("secure file changed during read");
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "distribution source", path: "/secure/rum-source.json", maximumBytes: 64 },
    { label: "collector private key", path: "/secure/rum-key.pem", maximumBytes: 64 },
  ])("bounded-reads only maximumBytes + 1 and rejects growth of the fixed $label", async ({
    path,
    maximumBytes,
  }) => {
    const content = Buffer.alloc(maximumBytes + 1, 0x61);
    const fixture = secureFileIoFixture({
      path,
      content,
      beforeSize: 4n,
      openedSize: 4n,
      afterSize: BigInt(content.length),
      afterMtimeNs: 11n,
      afterCtimeNs: 21n,
    });

    await expect(
      readSecureFixedFileForTest({ path, maximumBytes, io: fixture.io }),
    ).rejects.toThrow("secure file exceeds bounded read limit");
    expect(fixture.maximumRequestedBytes()).toBeLessThanOrEqual(maximumBytes + 1);
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("runs as a direct Node CLI and emits a bounded fail-closed JSON report", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/p2-staging-inp-rum.mjs"), "--action", "readiness"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          NODE_NO_WARNINGS: "1",
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "uais-staging-inp-lifecycle",
      action: "readiness",
      status: "BLOCKED_ENV",
      measurementProvenance: { status: "notVerified" },
      valuesRedacted: true,
      secretValuesOmitted: true,
    });
  });

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

  it("keeps setup provenance measurement-not-applicable and emits no collector receipt", async () => {
    const setup = vi.fn(async () => ({
      status: "ready" as const,
      cohortsTable: true,
      samplesTable: true,
      valuesRedacted: true as const,
    }));
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "setup", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore: () => ({ setup }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      status: "PASS",
      action: "setup",
      measurementProvenance: { status: "notApplicable" },
      externalAuthorityVerified: false,
      soakAdmissionEligibleByItself: false,
    });
    expect(result.report).not.toHaveProperty("collectorSourceReceipt");
    expect(result.report).not.toHaveProperty("operatorAttestedOnly");
    expect(setup).toHaveBeenCalledOnce();
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

  it("requires the exact immutable deployment id and rejects a mismatch before creating a store", async () => {
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv({ P2_IMMUTABLE_DEPLOYMENT_ID: "dpl_DifferentDeployment123456" }),
      verifiedContentSha: candidateContentSha,
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining(["immutable-deployment-id-mismatch"]),
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("fails closed before creating a store when an independently signed distribution is unavailable", async () => {
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
        cohortId,
      ],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining([
        "signed-distribution-source-ref-required",
        "collector-private-key-source-ref-required",
      ]),
      measurementProvenance: {
        status: "notVerified",
      },
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("rejects a correctly signed distribution bound to another candidate before store creation", async () => {
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({
        payload: { candidateGitSha: "9".repeat(40) },
      }),
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: ["collector-evidence-source-invalid-or-unreadable"],
      measurementProvenance: { status: "notVerified" },
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("rejects a correctly signed but stale account-cleanup attestation before store creation", async () => {
    const createStore = vi.fn();
    const staleMeasurementCompletedAt = "2026-08-28T02:57:30.000Z";
    const staleAccountCleanupVerifiedAt = "2026-08-28T02:58:00.000Z";
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({
        payload: {
          measurementCompletedAt: staleMeasurementCompletedAt,
          issuedAt: staleAccountCleanupVerifiedAt,
          accountCleanup: {
            accountMappingsRemaining: 0,
            temporaryAccountsRemaining: 0,
            verifiedAt: staleAccountCleanupVerifiedAt,
          },
        },
      }),
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: ["collector-evidence-source-invalid-or-unreadable"],
      measurementProvenance: { status: "notVerified" },
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("rejects a signed source whose claimed issue time predates account cleanup", async () => {
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({
        payload: { issuedAt: measurementCompletedAt },
      }),
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: ["collector-evidence-source-invalid-or-unreadable"],
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it.each([
    { field: "accountMappingsRemaining", accountMappingsRemaining: 1, temporaryAccountsRemaining: 0 },
    { field: "temporaryAccountsRemaining", accountMappingsRemaining: 0, temporaryAccountsRemaining: 1 },
  ])("rejects a signed source showing reappeared $field before store creation", async ({
    accountMappingsRemaining,
    temporaryAccountsRemaining,
  }) => {
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "finalize", "--cohort", cohortId, "--confirm-close", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({
        payload: {
          accountCleanup: {
            accountMappingsRemaining,
            temporaryAccountsRemaining,
            verifiedAt: accountCleanupVerifiedAt,
          },
        },
      }),
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: ["collector-evidence-source-invalid-or-unreadable"],
      measurementProvenance: { status: "notVerified" },
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("validates readiness against a signed distribution but cannot emit cleanup-complete promotion evidence", async () => {
    const readiness = vi.fn(async (binding) => ({
      ...binding,
      state: "open" as const,
      groups: passingGroups(),
    }));
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence(),
      createStore: () => ({ readiness }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      status: "PASS",
      lifecycleState: "open",
      threshold: {
        passingGroups: 12,
        storeAggregateMatched: true,
        percentileAlgorithm: "postgresql-percentile-cont-linear-interpolation-v1",
      },
      measurementProvenance: {
        status: "validated",
        exactDistributionSourceVerified: true,
        storeAggregateMatched: true,
      },
      soakAdmissionEligibleByItself: false,
    });
    expect(result.report).not.toHaveProperty("collectorSourceReceipt");
  });

  it("treats a histogram fabricated on the scalar store aggregate as non-authoritative", async () => {
    const storeGroups = passingGroups();
    const fabricatedStoreGroups = [
      { ...storeGroups[0], histogram: [{ valueMs: storeGroups[0].p75Ms, count: 30 }] },
      ...storeGroups.slice(1),
    ];
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence(),
      createStore: () => ({
        readiness: async (binding: UaisStagingInpBinding) => ({
          ...binding,
          state: "open" as const,
          groups: fabricatedStoreGroups,
        }),
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({
      status: "NOT_READY",
      threshold: {
        storeAggregateSchemaValid: false,
        storeAggregateMatched: false,
        storeAggregateFailureCode: "store-aggregate-schema-invalid",
      },
      measurementProvenance: {
        status: "notVerified",
        exactDistributionSourceVerified: true,
        storeAggregateMatched: false,
      },
    });
    expect(result.report).not.toHaveProperty("collectorSourceReceipt");
  });

  it("uses PostgreSQL percentile_cont boundary semantics when the p75 position is an exact rank", async () => {
    const distributionGroups = passingDistributionGroups();
    distributionGroups[0] = {
      ...distributionGroups[0],
      sampleCount: 29,
      p75Ms: 150,
      histogram: [
        { valueMs: 100, count: 7 },
        { valueMs: 150, count: 15 },
        { valueMs: 190, count: 7 },
      ],
    };
    const storeGroups = passingGroups();
    storeGroups[0] = { ...storeGroups[0], n: 29, p75Ms: 150 };
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({ groups: distributionGroups }),
      createStore: () => ({
        readiness: async (binding: UaisStagingInpBinding) => ({
          ...binding,
          state: "open" as const,
          groups: storeGroups,
        }),
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({
      status: "NOT_READY",
      threshold: {
        passingGroups: 11,
        storeAggregateMatched: true,
        percentileAlgorithm: "postgresql-percentile-cont-linear-interpolation-v1",
      },
      measurementProvenance: {
        status: "validated",
        exactDistributionSourceVerified: true,
        storeAggregateMatched: true,
      },
    });
    expect(
      (result.report.groups as ReturnType<typeof passingDistributionGroups>).find(
        (group) =>
          group.role === "student" &&
          group.journey === "student-learning" &&
          group.viewportClass === "compact",
      ),
    ).toMatchObject({ sampleCount: 29, p75Ms: 150 });
  });

  it("accepts 1000 buckets, integer 60000ms, and an exact total cohort budget of 4000", async () => {
    const distributionGroups = passingDistributionGroups();
    distributionGroups[0] = {
      ...distributionGroups[0],
      sampleCount: 3_670,
      p75Ms: 693.75,
      histogram: Array.from({ length: 1_000 }, (_, valueMs) => ({
        valueMs,
        count: valueMs < 670 ? 4 : 3,
      })),
    };
    distributionGroups[1] = {
      ...distributionGroups[1],
      p75Ms: 60_000,
      histogram: [{ valueMs: 60_000, count: 30 }],
    };
    const storeGroups = passingGroups();
    storeGroups[0] = { ...storeGroups[0], n: 3_670, p75Ms: 693.75 };
    storeGroups[1] = { ...storeGroups[1], p75Ms: 60_000 };
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({ groups: distributionGroups }),
      createStore: () => ({
        readiness: async (binding: UaisStagingInpBinding) => ({
          ...binding,
          state: "open" as const,
          groups: storeGroups,
        }),
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({
      status: "NOT_READY",
      threshold: {
        passingGroups: 10,
        storeAggregateMatched: true,
      },
      measurementProvenance: {
        status: "validated",
        storeAggregateMatched: true,
      },
    });
    expect(
      (result.report.groups as ReturnType<typeof passingDistributionGroups>).reduce(
        (total, group) => total + group.sampleCount,
        0,
      ),
    ).toBe(4_000);
  });

  it("rejects an otherwise valid exact-12 distribution whose cohort total is 4001", async () => {
    const groups = passingDistributionGroups();
    groups[0] = {
      ...groups[0],
      sampleCount: 3_671,
      p75Ms: 694,
      histogram: Array.from({ length: 1_000 }, (_, valueMs) => ({
        valueMs,
        count: valueMs < 670 || valueMs === 999 ? 4 : 3,
      })),
    };
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({ groups }),
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: ["collector-evidence-source-invalid-or-unreadable"],
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "1001 histogram buckets",
      patch: {
        sampleCount: 1_001,
        p75Ms: 750,
        histogram: Array.from({ length: 1_001 }, (_, valueMs) => ({ valueMs, count: 1 })),
      },
    },
    {
      label: "4001 samples",
      patch: {
        sampleCount: 4_001,
        p75Ms: 100,
        histogram: [{ valueMs: 100, count: 4_001 }],
      },
    },
    {
      label: "value above 60000ms",
      patch: {
        p75Ms: 60_001,
        histogram: [{ valueMs: 60_001, count: 30 }],
      },
    },
    {
      label: "non-integer value",
      patch: {
        p75Ms: 100.5,
        histogram: [{ valueMs: 100.5, count: 30 }],
      },
    },
  ])("rejects producer distribution beyond the exact bound: $label", async ({ patch }) => {
    const groups = passingDistributionGroups();
    groups[0] = { ...groups[0], ...patch };
    const createStore = vi.fn();
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readiness", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({
        groups: groups as ReturnType<typeof passingDistributionGroups>,
      }),
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: ["collector-evidence-source-invalid-or-unreadable"],
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
      rawSampleRowsDeleted: 360,
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
      cohortTombstoneRetained: true as const,
    }));
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsRemaining: 0,
      cohortTombstoneRetained: true as const,
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
      collectorEvidence: collectorEvidence(),
      createStore: () => ({ aggregate, purge, readback }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      status: "PASS",
      receiptSchemaVersion: 2,
      receiptKind: "uais-staging-inp-lifecycle-report",
      evidenceClass: "bounded-current-sha-isolated-staging-rum",
      candidateBinding: {
        cohortId,
        sourceRunId: cohortId,
        candidateGitSha,
        candidateContentSha,
        deploymentId,
        deploymentHost,
        projectId: UAIS_STAGING_INP_PROJECT_ID,
      },
      threshold: {
        requiredGroups: 12,
        passingGroups: 12,
        minimumSamplesPerGroup: 30,
        minimumDistinctOperatorsPerGroup: 3,
        maximumP75Ms: 200,
      },
      cleanup: {
        state: "purged",
        rawSampleRowsRemaining: 0,
        rawSampleRowsZero: true,
        cohortTombstoneRetained: true,
      },
      measurementProvenance: {
        status: "validated",
        percentileAlgorithm: "postgresql-percentile-cont-linear-interpolation-v1",
        exactDistributionSourceVerified: true,
        storeAggregateMatched: true,
      },
      collectorSourceReceipt: {
        payload: {
          schemaVersion: 1,
          kind: "uais-staging-inp-rum-source",
          actionScope: "collect-real-user-inp-staging-only",
          candidateGitSha,
          candidateContentSha256: candidateContentSha,
          projectId: UAIS_STAGING_INP_PROJECT_ID,
          deploymentId,
          deploymentHost,
          runId: cohortId,
          cohortId,
          collectorKeyVersion: "v1",
          collectorKeyId,
          collectorPublicKeySpkiSha256,
          measurementStartedAt,
          measurementCompletedAt,
          cleanupReceipt: {
            schemaVersion: 1,
            kind: "uais-staging-inp-rum-cleanup",
            actionScope: "cleanup-staging-rum-only",
            runId: cohortId,
            cohortId,
            rawSampleRowsRemaining: 0,
            accountMappingsRemaining: 0,
            temporaryAccountsRemaining: 0,
            cohortTombstoneRetained: true,
            accountCleanupVerifiedAt,
            rawSampleCleanupVerifiedAt: nowIso,
          },
        },
        signature: {
          algorithm: "Ed25519",
          keyId: collectorKeyId,
          payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          signatureBase64: expect.any(String),
        },
      },
      productionFieldInpProven: false,
      localSourceReportOnly: true,
      externalAuthorityVerified: false,
      independentRealUserApprovalRequired: true,
      soakAdmissionEligibleByItself: false,
    });
    expect(aggregate).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
    const receipt = result.report.collectorSourceReceipt as {
      payload: Record<string, unknown> & {
        cleanupReceipt: Record<string, unknown>;
        cleanupReceiptSha256: string;
        groups: Array<Record<string, unknown> & { role: string; journey: string; viewportClass: string }>;
        operatorAllowlistSha256: string;
        operatorFingerprints: string[];
      };
      signature: { payloadSha256: string; signatureBase64: string };
    };
    expect(Object.keys(receipt.payload).sort()).toEqual(
      [
        "accountMappingDigestSha256",
        "actionScope",
        "candidateContentSha256",
        "candidateGitSha",
        "cleanupReceipt",
        "cleanupReceiptSha256",
        "cohortId",
        "collectorKeyId",
        "collectorKeyVersion",
        "collectorPublicKeySpkiSha256",
        "deploymentHost",
        "deploymentId",
        "generatedAt",
        "groups",
        "kind",
        "measurementCompletedAt",
        "measurementStartedAt",
        "operatorAllowlistSha256",
        "operatorFingerprints",
        "percentileAlgorithm",
        "projectId",
        "runId",
        "schemaVersion",
        "sourceReportSha256",
      ].sort(),
    );
    expect(Object.keys(receipt.signature).sort()).toEqual(
      ["algorithm", "keyId", "payloadSha256", "signatureBase64"].sort(),
    );
    expect(Object.keys(receipt.payload.cleanupReceipt).sort()).toEqual(
      [
        "accountMappingsRemaining",
        "actionScope",
        "cohortId",
        "cohortTombstoneRetained",
        "accountCleanupVerifiedAt",
        "kind",
        "rawSampleRowsRemaining",
        "rawSampleCleanupVerifiedAt",
        "runId",
        "schemaVersion",
        "temporaryAccountsRemaining",
      ].sort(),
    );
    for (const group of receipt.payload.groups) {
      expect(Object.keys(group).sort()).toEqual(
        [
          "distinctAdultHumanCount",
          "distinctOperatorCount",
          "histogram",
          "journey",
          "p75Ms",
          "role",
          "sampleCount",
          "viewportClass",
        ].sort(),
      );
    }
    expect(
      receipt.payload.groups.map(({ role, journey, viewportClass }) =>
        `${role}\u0000${journey}\u0000${viewportClass}`,
      ),
    ).toEqual(
      passingDistributionGroups().map(({ role, journey, viewportClass }) =>
        `${role}\u0000${journey}\u0000${viewportClass}`,
      ),
    );
    expect(receipt.payload.operatorAllowlistSha256).toBe(
      sha256(canonicalJson(receipt.payload.operatorFingerprints)),
    );
    expect(receipt.payload.cleanupReceiptSha256).toBe(
      sha256(canonicalJson(receipt.payload.cleanupReceipt)),
    );
    expect(receipt.payload.generatedAt).toBe(
      receipt.payload.cleanupReceipt.rawSampleCleanupVerifiedAt,
    );
    expect(result.report.collectorSourceReceiptSha256).toBe(
      sha256(canonicalJson(receipt)),
    );
    const payloadJson = canonicalJson(receipt.payload);
    expect(sha256(payloadJson)).toBe(receipt.signature.payloadSha256);
    expect(
      verifyBytes(
        null,
        Buffer.from(payloadJson),
        collectorKeyPair.publicKey,
        Buffer.from(receipt.signature.signatureBase64, "base64"),
      ),
    ).toBe(true);
    const serializedReport = JSON.stringify(result.report);
    expect(serializedReport).not.toContain("PRIVATE KEY");
    expect(serializedReport).not.toContain(readyEnv().UAIS_STAGING_INP_HMAC_SECRET);
    expect(serializedReport).not.toContain(readyEnv().UAIS_P2_STAGING_DATABASE_URL);
    expect(serializedReport).not.toContain(collectorPrivateKeyPem);
  });

  it("refuses to restamp account cleanup when freshness expires during finalize", async () => {
    const evidence = collectorEvidence();
    const observedTimes = [
      new Date(nowIso),
      new Date("2026-08-28T03:01:00.000Z"),
    ];
    evidence.now = () => observedTimes.shift() ?? new Date("2026-08-28T03:01:00.000Z");
    const purge = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsDeleted: 360,
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
      cohortTombstoneRetained: true as const,
    }));
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsRemaining: 0,
      cohortTombstoneRetained: true as const,
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
      collectorEvidence: evidence,
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
      failureCode: "staging-inp-account-cleanup-freshness-expired",
      cleanup: {
        rawSampleRowsRemaining: 0,
        rawSampleRowsZero: true,
        cohortTombstoneRetained: true,
      },
      measurementProvenance: { status: "validated" },
    });
    expect(result.report).not.toHaveProperty("cleanupReceipt");
    expect(result.report).not.toHaveProperty("collectorSourceReceipt");
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "duplicate expected group",
      mutate: (groups: ReturnType<typeof passingGroups>) => [...groups, groups[0]],
    },
    {
      name: "unknown group",
      mutate: (groups: ReturnType<typeof passingGroups>) => [
        ...groups.slice(0, -1),
        { ...groups.at(-1)!, journey: "teacher-unknown" as never },
      ],
    },
    {
      name: "string sample count",
      mutate: (groups: ReturnType<typeof passingGroups>) => [
        { ...groups[0], n: "30" as never },
        ...groups.slice(1),
      ],
    },
    {
      name: "non-finite p75",
      mutate: (groups: ReturnType<typeof passingGroups>) => [
        { ...groups[0], p75Ms: Number.NaN },
        ...groups.slice(1),
      ],
    },
    {
      name: "negative operator count",
      mutate: (groups: ReturnType<typeof passingGroups>) => [
        { ...groups[0], distinctOperatorCount: -1 },
        ...groups.slice(1),
      ],
    },
  ])("fails closed for malformed store aggregate: $name, while still purging", async ({ mutate }) => {
    const groups = mutate(passingGroups());
    const purge = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsDeleted: 360,
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
      cohortTombstoneRetained: true as const,
    }));
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsRemaining: 0,
      cohortTombstoneRetained: true as const,
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
      collectorEvidence: collectorEvidence(),
      createStore: () => ({
        aggregate: async (binding: UaisStagingInpBinding) => ({
          ...binding,
          state: "closed" as const,
          groups,
          threshold: { ready: true, passingGroups: 12 },
        }),
        purge,
        readback,
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.report).toMatchObject({
      status: "FAIL",
      threshold: {
        ready: false,
        groupSchemaValid: true,
        storeAggregateSchemaValid: false,
        storeAggregateMatched: false,
      },
      cleanup: { rawSampleRowsZero: true },
    });
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it("reports a threshold failure but still purges and reads back zero residue", async () => {
    const groups = passingGroups();
    groups[0] = { ...groups[0], n: 29, p75Ms: 240 };
    const distributionGroups = passingDistributionGroups();
    distributionGroups[0] = {
      ...distributionGroups[0],
      sampleCount: 29,
      p75Ms: 240,
      histogram: [{ valueMs: 240, count: 29 }],
    };
    const purge = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsDeleted: 359,
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
      cohortTombstoneRetained: true as const,
    }));
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsRemaining: 0,
      cohortTombstoneRetained: true as const,
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
      collectorEvidence: collectorEvidence({ groups: distributionGroups }),
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
      cleanup: { rawSampleRowsZero: true, rawSampleRowsRemaining: 0 },
      productionFieldInpProven: false,
    });
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it("rejects a signed source whose scalar p75 is forged below its exact distribution before store creation", async () => {
    const groups = passingDistributionGroups();
    groups[0] = {
      ...groups[0],
      p75Ms: 100,
      histogram: [{ valueMs: 500, count: 30 }],
    };
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
        cohortId,
      ],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      collectorEvidence: collectorEvidence({ groups }),
      createStore,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: ["collector-evidence-source-invalid-or-unreadable"],
      measurementProvenance: { status: "notVerified" },
    });
    expect(createStore).not.toHaveBeenCalled();
  });

  it("still attempts an independent readback when finalize cleanup purge fails", async () => {
    const purge = vi.fn(async () => {
      throw new Error("fixture purge failure");
    });
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "closed" as const,
      rawSampleRowsRemaining: 360,
      cohortTombstoneRetained: true as const,
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
      collectorEvidence: collectorEvidence(),
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
        rawSampleRowsRemaining: 360,
        rawSampleRowsZero: false,
      },
    });
    expect(purge).toHaveBeenCalledOnce();
    expect(readback).toHaveBeenCalledOnce();
  });

  it("keeps a standalone purge receipt cleanup-scoped and measurement-not-applicable", async () => {
    const purge = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsDeleted: 12,
      rawSampleRowsRemaining: 0,
      rawSampleRowsZero: true,
      cohortTombstoneRetained: true as const,
    }));
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "purged" as const,
      rawSampleRowsRemaining: 0,
      cohortTombstoneRetained: true as const,
    }));
    const result = await runP2StagingInpLifecycle({
      argv: [
        "--live",
        "--approved",
        "--action",
        "purge",
        "--cohort",
        cohortId,
        "--confirm-purge",
        cohortId,
      ],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore: () => ({ purge, readback }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      status: "PASS",
      action: "purge",
      measurementProvenance: { status: "notApplicable" },
      cleanup: {
        rawSampleRowsRemaining: 0,
        rawSampleRowsZero: true,
        cohortTombstoneRetained: true,
      },
      externalAuthorityVerified: false,
      soakAdmissionEligibleByItself: false,
    });
    expect(result.report).not.toHaveProperty("collectorSourceReceipt");
  });

  it("keeps standalone readback observational and measurement-not-applicable", async () => {
    const readback = vi.fn(async (binding) => ({
      ...binding,
      state: "closed" as const,
      rawSampleRowsRemaining: 12,
      cohortTombstoneRetained: true as const,
    }));
    const result = await runP2StagingInpLifecycle({
      argv: ["--live", "--approved", "--action", "readback", "--cohort", cohortId],
      env: readyEnv(),
      verifiedContentSha: candidateContentSha,
      createStore: () => ({ readback }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toMatchObject({
      status: "PASS",
      action: "readback",
      measurementProvenance: { status: "notApplicable" },
      readback: {
        state: "closed",
        rawSampleRowsRemaining: 12,
        cohortTombstoneRetained: true,
      },
      externalAuthorityVerified: false,
      soakAdmissionEligibleByItself: false,
    });
    expect(result.report).not.toHaveProperty("collectorSourceReceipt");
  });

  it("keeps CLI expiry cleanup available after collection credentials are removed", async () => {
    const purgeExpired = vi.fn(async () => ({
      cohortsAutoClosed: 2,
      expiredRawSampleRowsDeleted: 7,
      expiredRawSampleRowsRemaining: 0,
      expiredRawSampleRowsZero: true,
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
        cohortsAutoClosed: 2,
        expiredRawSampleRowsDeleted: 7,
        expiredRawSampleRowsRemaining: 0,
        expiredRawSampleRowsZero: true,
      },
    });
    expect(purgeExpired).toHaveBeenCalledOnce();
  });
});
