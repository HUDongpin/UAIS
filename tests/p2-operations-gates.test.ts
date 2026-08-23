import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cleanEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};
const repositoryHeadSha = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: cleanEnv,
}).stdout.trim();

type ClosureManifestFixture = {
  candidate: {
    gitSha: string;
    deployment: { gitSha: string };
  };
  requirements: Array<{ id: number; status: string }>;
};

const candidateGitSha = "1".repeat(40);
const candidateContentSha = "a".repeat(64);
const evidenceBindingEnv = {
  P2_CANDIDATE_GIT_SHA: candidateGitSha,
  P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
  P2_DEPLOYMENT_ID: "dpl_1234567890abcdefghijklmnopqrstuv",
  P2_IMMUTABLE_DEPLOYMENT_URL:
    "https://uais-staging-a1b2c3d4-owner.vercel.app",
};

describe("P2 protected operations gates", () => {
  it("reports BLOCKED_ENV instead of contacting a load target when staging is absent", () => {
    const result = run("scripts/p2-load-test.mjs", [], cleanEnv);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-staging-load",
      status: "BLOCKED_ENV",
      networkUsed: false,
      blockedReasons: expect.arrayContaining([
        "missing-P2_LOAD_BASE_URL",
        "missing-P2_LOAD_CONFIRM",
      ]),
    });
  });

  it("rejects production load targets before any request", () => {
    const result = run("scripts/p2-load-test.mjs", ["--dry-run"], {
      ...cleanEnv,
      P2_LOAD_BASE_URL: "https://uais.top",
      P2_LOAD_ALLOWLIST: "uais.top,staging.uais.top",
      P2_LOAD_CONFIRM: "staging",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "FAIL",
      networkUsed: false,
      blockedReasons: ["production-hostname-rejected"],
    });
  });

  it("builds the 5-to-200 staging ramp plan without using the network", () => {
    const result = run("scripts/p2-load-test.mjs", ["--dry-run"], {
      ...cleanEnv,
      P2_LOAD_BASE_URL: "https://staging.uais.top",
      P2_LOAD_ALLOWLIST: "staging.uais.top",
      P2_LOAD_CONFIRM: "staging",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "PASS",
      mode: "dry-run",
      networkUsed: false,
      scenarios: [
        expect.objectContaining({
          id: "invite-join",
          users: 200,
          userRamp: [5, 20, 50, 100, 200],
        }),
        expect.objectContaining({
          id: "group-collaboration",
          users: 200,
          groups: 40,
          durationSeconds: 600,
          provider: "deterministic-stub",
        }),
      ],
    });
  });

  it("reports the missing staging executor explicitly instead of an empty blocker", () => {
    const result = run("scripts/p2-load-test.mjs", [], {
      ...cleanEnv,
      P2_LOAD_BASE_URL: "https://staging.uais.top",
      P2_LOAD_ALLOWLIST: "staging.uais.top",
      P2_LOAD_CONFIRM: "staging",
      P2_LOAD_FIXTURE_MANIFEST: "/redacted/p2-load-fixture.json",
      P2_LOAD_CLEANUP_CONFIRM: "run-id-cleanup",
    });

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      networkUsed: false,
      blockedReasons: ["staging-load-executor-not-configured"],
    });
  });

  it("blocks live provider smoke until every cost and safety proof is present", () => {
    const result = run("scripts/p2-provider-live-smoke.mjs", [], cleanEnv);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-provider-live-smoke",
      status: "BLOCKED_ENV",
      networkUsed: false,
      maxRequests: 3,
      blockedReasons: expect.arrayContaining([
        "missing-P2_PROVIDER_LIVE_CONFIRM",
        "missing-P2_PROVIDER_BUDGET_CAP_USD",
        "missing-P2_PROVIDER_RATE_LIMIT_RPM",
        "missing-P2_PROVIDER_MONITORING",
      ]),
    });
  });

  it("builds the five-page Lighthouse plan without starting a server or browser", () => {
    const result = run("scripts/p2-performance-test.mjs", ["--dry-run"], cleanEnv);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-performance",
      status: "NOT_RUN",
      mode: "dry-run",
      networkUsed: false,
      pages: ["/login", "/courses", "/learning", "/learning/chatroom", "/teaching"],
      budgets: {
        lighthousePerformanceMinimum: 85,
        largestContentfulPaintMillisecondsMaximum: 2_500,
        cumulativeLayoutShiftMaximum: 0.1,
        totalBlockingTimeMillisecondsMaximum: 200,
      },
    });
  });

  it("rejects a production hostname before a Lighthouse request", () => {
    const result = run("scripts/p2-performance-test.mjs", ["--dry-run"], {
      ...cleanEnv,
      P2_PERFORMANCE_BASE_URL: "https://uais.top",
      P2_PERFORMANCE_ALLOWLIST: "uais.top,staging.uais.top",
      P2_PERFORMANCE_CONFIRM: "staging",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "FAIL",
      networkUsed: false,
      blockedReasons: ["production-hostname-rejected"],
    });
  });

  it("lists the local P2 quality gate in its required order without executing it", () => {
    const result = run("scripts/p2-quality-gate.mjs", ["--dry-run"], cleanEnv);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-local-quality-gate",
      status: "NOT_RUN",
      commands: [
        "npm run lint",
        "npm run test",
        "npm run test:critical",
        "npm run build",
        "npm run test:p2:e2e",
        "npm run test:p2:a11y",
        "npm run test:p2:performance",
        "node scripts/p2-evidence-check.mjs",
      ],
    });
  });

  it("keeps the current-candidate closure gate blocked until all eleven external gates pass", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "uais-p2-closure-gate-"),
    );
    try {
      const manifestPath = writeClosureManifest(temporaryDirectory);
      const result = run(
        "scripts/p2-current-candidate-closure-gate.mjs",
        ["--manifest", manifestPath],
        cleanEnv,
      );

      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        target: "p2-current-candidate-closure",
        status: "BLOCKED_ENV",
        releaseReady: false,
        candidate: {
          gitSha: repositoryHeadSha,
          sameShaImmutableDeployment: "PASS",
        },
        requirements: {
          total: 11,
          passed: 1,
          passedIds: [2],
          blockedIds: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        },
        teacherWorkspaces: {
          total: 11,
          realComplete: 0,
          implementedUnverified: 11,
        },
        credentialSources: {
          total: 7,
          ownerApproved: 0,
          missing: 7,
        },
        safety: {
          valuesRedacted: true,
          historicalEvidenceCannotPass: true,
        },
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a historical restore record promoted to PASS", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "uais-p2-closure-gate-"),
    );
    try {
      const manifestPath = writeClosureManifest(
        temporaryDirectory,
        (manifest) => {
          const restoreRequirement = manifest.requirements.find(
            (requirement) => requirement.id === 3,
          );
          if (!restoreRequirement) {
            throw new Error("Restore requirement fixture is missing.");
          }
          restoreRequirement.status = "PASS";
        },
      );

      const result = run(
        "scripts/p2-current-candidate-closure-gate.mjs",
        ["--manifest", manifestPath],
        cleanEnv,
      );

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        target: "p2-current-candidate-closure",
        status: "FAIL",
        releaseReady: false,
        validationErrors: expect.arrayContaining([
          "requirement-3-pass-requires-current-evidence",
          "requirement-3-historical-evidence-cannot-pass",
        ]),
        safety: {
          valuesRedacted: true,
          historicalEvidenceCannotPass: true,
        },
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("requires dedicated P2 database URLs and internal guards before migrations or writes", () => {
    const buildSource = readFileSync("scripts/p2-staging-build.mjs", "utf8");
    const liveSource = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");

    for (const source of [buildSource, liveSource]) {
      expect(source).toContain("UAIS_P2_STAGING_DATABASE_URL");
      expect(source).toContain("UAIS_P2_STAGING_RESTORE_DATABASE_URL");
      expect(source).toContain("isolated-p2-staging-source");
      expect(source).toContain("isolated-p2-staging-restore");
      expect(source).not.toContain("process.env.DATABASE_URL");
      expect(source).not.toContain("process.env.POSTGRES_URL");
    }

    const buildGuard = buildSource.indexOf("await assertDatabaseGuard(");
    const firstMigration = buildSource.indexOf(
      'runNode(["scripts/apply-core-migrations.mjs"]',
    );
    expect(buildGuard).toBeGreaterThan(-1);
    expect(firstMigration).toBeGreaterThan(buildGuard);

    const liveGuard = liveSource.indexOf("await validateDatabaseGuards(");
    const firstCleanup = liveSource.indexOf("await cleanupTaggedData(sourceSql");
    expect(liveGuard).toBeGreaterThan(-1);
    expect(firstCleanup).toBeGreaterThan(liveGuard);
  });

  it("keeps the staging database guard-only mode read-only", () => {
    const buildSource = readFileSync("scripts/p2-staging-build.mjs", "utf8");
    const sourceGuard = buildSource.indexOf(
      'await assertDatabaseGuard(\n  sourceDatabaseUrl,\n  "isolated-p2-staging-source",',
    );
    const guardOnlyExit = buildSource.indexOf(
      'target: "p2-isolated-staging-database-guard"',
    );
    const firstMigration = buildSource.indexOf(
      'runNode(["scripts/apply-core-migrations.mjs"]',
    );

    expect(buildSource).toContain(
      'const guardOnly = process.argv.includes("--guard-only");',
    );
    expect(sourceGuard).toBeGreaterThan(-1);
    expect(guardOnlyExit).toBeGreaterThan(sourceGuard);
    expect(firstMigration).toBeGreaterThan(guardOnlyExit);
    expect(buildSource).toContain("noMutationPerformed: true");
  });

  it("keeps the live executor on the declared 5-to-200 cumulative ramp", () => {
    const liveSource = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");

    expect(liveSource).toContain(
      "const expectedUserRamp = Object.freeze([5, 20, 50, 100, 200]);",
    );
    expect(liveSource).toContain("for (const targetUsers of expectedUserRamp)");
    expect(liveSource).toContain('emitProgress("invite-join-ramp-stage-complete"');
  });

  it("blocks unbound staging evidence before any network or database use", () => {
    const result = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run", "--health-only"],
      {
        ...cleanEnv,
        P2_LOAD_BASE_URL:
          "https://uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_ALLOWLIST: "uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_CONFIRM: "staging",
        UAIS_DEPLOYMENT_ENV: "staging",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      },
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-isolated-staging-live-executor",
      status: "BLOCKED_ENV",
      failureCode: "UNBOUND_EVIDENCE",
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      blockedReasons: expect.arrayContaining([
        "missing-P2_CANDIDATE_GIT_SHA",
        "missing-P2_CANDIDATE_CONTENT_SHA",
        "missing-P2_DEPLOYMENT_ID",
        "missing-P2_IMMUTABLE_DEPLOYMENT_URL",
      ]),
      safety: { networkUsed: false },
    });
  });

  it("rejects a mutable staging alias when evidence names an immutable deployment", () => {
    const result = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run", "--health-only"],
      {
        ...cleanEnv,
        ...evidenceBindingEnv,
        P2_LOAD_BASE_URL: "https://staging.uais.top",
        P2_LOAD_ALLOWLIST: "staging.uais.top",
        P2_LOAD_CONFIRM: "staging",
        UAIS_DEPLOYMENT_ENV: "staging",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      },
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining([
        "immutable-deployment-target-required",
      ]),
      safety: { networkUsed: false },
    });
  });

  it("blocks immutable execution without a protection bypass before network use", () => {
    const result = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--health-only"],
      {
        ...cleanEnv,
        ...evidenceBindingEnv,
        P2_LOAD_BASE_URL:
          "https://uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_ALLOWLIST: "uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_CONFIRM: "staging",
        UAIS_DEPLOYMENT_ENV: "staging",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      },
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      mode: "preflight",
      blockedReasons: ["missing-P2_VERCEL_PROTECTION_BYPASS_SECRET"],
      safety: { networkUsed: false },
    });
  });

  it("rejects malformed candidate and deployment identities before network use", () => {
    const result = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run", "--health-only"],
      {
        ...cleanEnv,
        P2_LOAD_BASE_URL: "https://staging.uais.top",
        P2_LOAD_ALLOWLIST: "staging.uais.top",
        P2_LOAD_CONFIRM: "staging",
        UAIS_DEPLOYMENT_ENV: "staging",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
        P2_CANDIDATE_GIT_SHA: "main",
        P2_CANDIDATE_CONTENT_SHA: "short",
        P2_DEPLOYMENT_ID: "latest",
        P2_IMMUTABLE_DEPLOYMENT_URL: "https://staging.uais.top",
      },
    );

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      failureCode: "UNBOUND_EVIDENCE",
      blockedReasons: expect.arrayContaining([
        "invalid-P2_CANDIDATE_GIT_SHA",
        "invalid-P2_CANDIDATE_CONTENT_SHA",
        "invalid-P2_DEPLOYMENT_ID",
        "invalid-P2_IMMUTABLE_DEPLOYMENT_URL",
      ]),
      safety: { networkUsed: false },
    });
  });

  it("rejects the production Neon project on both source and restore boundaries", () => {
    const sourceBuildResult = run("scripts/p2-staging-build.mjs", [], {
      ...cleanEnv,
      VERCEL_PROJECT_ID: "intentionally-wrong-project-id",
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      UAIS_P2_STAGING_DATABASE_URL: "postgres://source.invalid/uais",
      UAIS_P2_STAGING_RESTORE_DATABASE_URL: "postgres://restore.invalid/uais",
      NEON_PROJECT_ID: "late-sunset-59152574",
      RESTORE_NEON_PROJECT_ID: "staging-restore-project",
    });

    expect(sourceBuildResult.status).toBe(2);
    expect(JSON.parse(sourceBuildResult.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining(["production-neon-project-id-rejected"]),
      valuesRedacted: true,
    });

    const buildResult = run("scripts/p2-staging-build.mjs", [], {
      ...cleanEnv,
      VERCEL_PROJECT_ID: "intentionally-wrong-project-id",
      UAIS_DEPLOYMENT_ENV: "staging",
      UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
      UAIS_P2_STAGING_DATABASE_URL: "postgres://source.invalid/uais",
      UAIS_P2_STAGING_RESTORE_DATABASE_URL: "postgres://restore.invalid/uais",
      NEON_PROJECT_ID: "staging-source-project",
      RESTORE_NEON_PROJECT_ID: "late-sunset-59152574",
    });

    expect(buildResult.status).toBe(2);
    expect(JSON.parse(buildResult.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining([
        "production-restore-neon-project-id-rejected",
      ]),
      valuesRedacted: true,
    });

    const liveResult = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run"],
      {
        ...cleanEnv,
        ...evidenceBindingEnv,
        P2_LOAD_BASE_URL: "https://staging.uais.top",
        P2_LOAD_ALLOWLIST: "staging.uais.top",
        P2_LOAD_CONFIRM: "staging",
        P2_LOAD_RUN_ID: "p2-restore-guard",
        P2_LOAD_CLEANUP_CONFIRM: "run-id-cleanup",
        P2_MANUAL_TEST_PASSWORD: "a-secure-manual-password-value-1234",
        UAIS_DEPLOYMENT_ENV: "staging",
        UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
        UAIS_P2_STAGING_DATABASE_URL: "postgres://source.invalid/uais",
        UAIS_P2_STAGING_RESTORE_DATABASE_URL: "postgres://restore.invalid/uais",
        NEON_PROJECT_ID: "staging-source-project",
        RESTORE_NEON_PROJECT_ID: "late-sunset-59152574",
      },
    );

    expect(liveResult.status).toBe(2);
    expect(JSON.parse(liveResult.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      mode: "dry-run",
      blockedReasons: expect.arrayContaining([
        "production-restore-neon-project-id-rejected",
      ]),
      safety: { networkUsed: false },
    });

    const sourceLiveResult = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run"],
      {
        ...cleanEnv,
        ...evidenceBindingEnv,
        P2_LOAD_BASE_URL: "https://staging.uais.top",
        P2_LOAD_ALLOWLIST: "staging.uais.top",
        P2_LOAD_CONFIRM: "staging",
        P2_LOAD_RUN_ID: "p2-source-guard",
        P2_LOAD_CLEANUP_CONFIRM: "run-id-cleanup",
        P2_MANUAL_TEST_PASSWORD: "a-secure-manual-password-value-1234",
        UAIS_DEPLOYMENT_ENV: "staging",
        UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
        UAIS_P2_STAGING_DATABASE_URL: "postgres://source.invalid/uais",
        UAIS_P2_STAGING_RESTORE_DATABASE_URL: "postgres://restore.invalid/uais",
        NEON_PROJECT_ID: "late-sunset-59152574",
        RESTORE_NEON_PROJECT_ID: "staging-restore-project",
      },
    );

    expect(sourceLiveResult.status).toBe(2);
    expect(JSON.parse(sourceLiveResult.stdout)).toMatchObject({
      status: "BLOCKED_ENV",
      mode: "dry-run",
      blockedReasons: ["production-neon-project-id-rejected"],
      safety: { networkUsed: false },
    });
  });

  it("preserves the migration 0009 learning-event and profile fields across restore", () => {
    const liveSource = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");
    const seedEvent = sliceBetween(
      liveSource,
      'currentStage = "core-learning-event-insert";',
      'currentStage = "core-learner-profile-insert";',
    );
    const capture = sliceBetween(
      liveSource,
      "async function captureTaggedBackup()",
      "async function restoreTaggedBackup(backup)",
    );
    const restore = sliceBetween(
      liveSource,
      "async function restoreTaggedBackup(backup)",
      "async function verifyRestoredBackup(",
    );
    const verification = sliceBetween(
      liveSource,
      "async function verifyRestoredBackup(",
      "async function cleanupTaggedData(",
    );

    for (const field of [
      "assessment_id",
      "submission_id",
      "idempotency_key",
      "schema_version",
      "source",
      "projection_version",
    ]) {
      expect(seedEvent).toContain(field);
      expect(capture).toContain(field);
      expect(restore).toContain(field);
    }
    expect(seedEvent).toContain("learning-loop-api");
    expect(seedEvent).toContain("p2-seed:");

    for (const field of ["progress", "projection_version", "last_event_at"]) {
      expect(capture).toContain(field);
      expect(restore).toContain(field);
    }

    for (const field of [
      "assessment_id",
      "submission_id",
      "idempotency_key",
      "schema_version",
      "source",
      "projection_version",
      "progress",
      "last_event_at",
    ]) {
      expect(verification).toContain(field);
    }
    expect(verification).toContain("createDeterministicChecksum");
    expect(verification).toContain("checksumsMatch");
    expect(verification).toContain("expectedCounts");
    expect(verification).toContain("mismatchReasons");
    expect(liveSource).toContain("report.restore = restoreVerificationRecord");
    expect(verification).not.toMatch(
      /SELECT count\(\*\)::int AS count\s+FROM uais_learning_(?:events|profiles)/,
    );
  });

  it("accepts the clean-commit content sentinel as an explicit operator input", () => {
    const result = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run"],
      {
        ...cleanEnv,
        ...evidenceBindingEnv,
        P2_CANDIDATE_CONTENT_SHA: "clean-commit",
        P2_LOAD_BASE_URL:
          "https://uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_ALLOWLIST: "uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_CONFIRM: "staging",
        P2_LOAD_RUN_ID: "p2-binding-proof",
        P2_LOAD_CLEANUP_CONFIRM: "run-id-cleanup",
        P2_MANUAL_TEST_PASSWORD: "a-secure-manual-password-value-1234",
        UAIS_DEPLOYMENT_ENV: "staging",
        UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
        UAIS_P2_STAGING_DATABASE_URL: "postgres://source.invalid/uais",
        UAIS_P2_STAGING_RESTORE_DATABASE_URL: "postgres://restore.invalid/uais",
        NEON_PROJECT_ID: "staging-source-project",
        RESTORE_NEON_PROJECT_ID: "staging-restore-project",
      },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "PASS",
      mode: "dry-run",
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      evidenceBinding: {
        candidateGitSha,
        candidateContent: {
          kind: "clean-commit-sentinel",
          value: "clean-commit",
        },
        deploymentIdFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        immutableDeploymentUrlFingerprint: expect.stringMatching(
          /^sha256:[0-9a-f]{64}$/,
        ),
        attestation: "operator-input-only-not-remote-verification",
      },
      safety: { networkUsed: false },
    });
  });

  it("keeps manual staging fixtures run-bound but outside the load restore namespace", () => {
    const buildSource = readFileSync("scripts/p2-staging-build.mjs", "utf8");
    const liveSource = readFileSync("scripts/p2-staging-live-load.mjs", "utf8");

    expect(buildSource).not.toMatch(/P2_LOAD_RUN_ID:\s*"p2-/);
    expect(liveSource).toContain('const loadPrefix = `${runId}-`;');
    expect(liveSource).toContain('const manualPrefix = `manual-${runId}-`;');
    expect(liveSource).not.toContain('const manualPrefix = `${loadPrefix}manual-`;');
    expect(liveSource).toContain(
      "const manualStudentAccount = `${manualPrefix}student`;",
    );
    expect(liveSource).toContain(
      "const manualTeacherAccount = `${manualPrefix}teacher`;",
    );
    expect(liveSource).not.toContain('"p2-manual-');
    expect(liveSource).toContain('courseName: "P2 Quality Pilot"');
    expect(liveSource).toContain('courseName: "P2 Manual Accessibility"');
    expect(liveSource).not.toContain('courseName: `P2 Quality Pilot ${runId}`');
    expect(liveSource).not.toContain('courseName: `P2 Manual Accessibility ${runId}`');
    expect(liveSource).toContain('currentStage = "manual-membership-join";');
    expect(liveSource).toContain('/^p2-[a-z0-9-]{8,23}$/');
    expect(liveSource).toContain("accountPrefixes: [manualPrefix]");
    expect(liveSource).toContain("textMarkers: [runId]");
  });

  it("keeps the staging build independent from the one-shot live load", () => {
    const buildSource = readFileSync("scripts/p2-staging-build.mjs", "utf8");

    expect(buildSource).not.toContain("scripts/p2-staging-live-load.mjs");
    expect(buildSource).not.toContain("P2_LOAD_RUN_ID");
    expect(buildSource).not.toContain("P2_LOAD_CLEANUP_CONFIRM");
  });

  it("plans the read-only health aggregate without database or fixture credentials", () => {
    const result = runTsx(
      "scripts/p2-staging-live-load.mjs",
      ["--dry-run", "--health-only"],
      {
        ...cleanEnv,
        ...evidenceBindingEnv,
        P2_LOAD_BASE_URL:
          "https://uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_ALLOWLIST: "uais-staging-a1b2c3d4-owner.vercel.app",
        P2_LOAD_CONFIRM: "staging",
        UAIS_DEPLOYMENT_ENV: "staging",
        VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
      },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      target: "p2-isolated-staging-live-executor",
      status: "PASS",
      mode: "dry-run",
      phase: "health-only",
      blockedReasons: [],
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      evidenceBinding: {
        candidateGitSha,
        candidateContent: {
          kind: "sha256",
          value: candidateContentSha,
        },
        deploymentIdFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        immutableDeploymentUrlFingerprint: expect.stringMatching(
          /^sha256:[0-9a-f]{64}$/,
        ),
        attestation: "operator-input-only-not-remote-verification",
      },
      plan: {
        healthOnly: true,
        userRamp: [5, 20, 50, 100, 200],
        healthSamples: 15,
        healthIntervalSeconds: 60,
      },
      safety: {
        networkUsed: false,
      },
    });
  });
});

function run(
  script: string,
  args: string[],
  env: Record<string, string | undefined>,
) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
}

function runTsx(
  script: string,
  args: string[],
  env: Record<string, string | undefined>,
) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function writeClosureManifest(
  directory: string,
  mutate?: (manifest: ClosureManifestFixture) => void,
) {
  const manifest = JSON.parse(
    readFileSync(
      "coordination/reports/p2/current-candidate-closure.json",
      "utf8",
    ),
  ) as ClosureManifestFixture;
  manifest.candidate.gitSha = repositoryHeadSha;
  manifest.candidate.deployment.gitSha = repositoryHeadSha;
  mutate?.(manifest);
  const manifestPath = join(directory, "current-candidate-closure.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}
