import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME,
  getUaisCoreDatabaseReadiness,
} from "@/lib/db/core-database";
import {
  computeUaisStagingCandidateContentManifest,
  computeUaisStagingCandidateContentSha,
  uaisStagingCandidateContentEntries,
} from "../scripts/p2-staging-candidate-content.mjs";
import {
  UAIS_STAGING_CONFIG_ATTESTATION,
  inspectStagingDatabaseTarget,
  readStagingRedactionValues,
  redactStagingChildOutput,
  runGuardedVercelStagingBuild,
} from "../scripts/vercel-staging-build-guard.mjs";

const dedicatedDatabaseUrl =
  "postgresql://staging-user:staging-secret@staging-db.example.test/uais";
const restoreDatabaseUrl =
  "postgresql://restore-user:restore-secret@restore-db.example.test/uais";
const candidateGitSha = "a".repeat(40);
const candidateContentSha = computeUaisStagingCandidateContentSha(process.cwd());
const deploymentHost = "uais-staging-current-team.vercel.app";

const safeStagingEnv = {
  VERCEL_ENV: "production",
  VERCEL_PROJECT_ID: "prj_dcWZvGLSYNtSWN3lnTyfZPyWKgQL",
  VERCEL_GIT_COMMIT_SHA: candidateGitSha,
  VERCEL_URL: deploymentHost,
  UAIS_DEPLOYMENT_ENV: "staging",
  UAIS_LEARNING_CHATROOM_GROUPS_MODE: "on",
  UAIS_STAGING_CONFIG_ATTESTATION,
  UAIS_STAGING_INP_RUM_ENABLED: "yes",
  UAIS_P2_STAGING_DATABASE_URL: dedicatedDatabaseUrl,
  NEON_PROJECT_ID: "neon-staging-project-fixture",
  P2_CANDIDATE_GIT_SHA: candidateGitSha,
  P2_CANDIDATE_CONTENT_SHA: candidateContentSha,
  UAIS_STAGING_INP_COHORT_ID: `p2-inp-${candidateGitSha}-run1`,
  UAIS_STAGING_INP_HMAC_SECRET: "staging-inp-hmac-secret-fixture-strong",
  UAIS_STAGING_INP_HMAC_KEY_VERSION: "v1",
  UAIS_APP_SESSION_SIGNING_SECRET: "app-session-secret-fixture-at-least-32",
  UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: ["c", "d", "e"]
    .map((value) => value.repeat(64))
    .join(","),
  CRON_SECRET: "staging-expiry-cron-secret-fixture-at-least-32",
  P2_VERCEL_PROTECTION_BYPASS_SECRET:
    "staging-protection-bypass-fixture-at-least-32",
};

const safeBaseStagingEnv = {
  ...safeStagingEnv,
  UAIS_STAGING_INP_RUM_ENABLED: "no",
  UAIS_STAGING_INP_COHORT_ID: undefined,
  UAIS_STAGING_INP_HMAC_SECRET: undefined,
  UAIS_STAGING_INP_HMAC_KEY_VERSION: undefined,
  UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: undefined,
};

describe("guarded Vercel staging build", () => {
  it("produces a redacted per-entry manifest without changing the aggregate digest", () => {
    const manifest = computeUaisStagingCandidateContentManifest(process.cwd());

    expect(manifest.sha256).toBe(candidateContentSha);
    expect(manifest.entries.map((entry) => entry.path)).toEqual(
      uaisStagingCandidateContentEntries,
    );
    expect(manifest.entries.every((entry) => entry.fileCount > 0)).toBe(true);
    expect(manifest.entries.every((entry) => entry.byteCount > 0)).toBe(true);
    expect(
      manifest.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)),
    ).toBe(true);
    expect(
      manifest.entries.find((entry) => entry.path === "vercel.json"),
    ).toMatchObject({
      jsonDiagnostic: {
        canonicalSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        topLevelKeys: ["$schema", "buildCommand", "framework", "git"],
        valuesRedacted: true,
      },
    });
    expect(manifest.valuesRedacted).toBe(true);
  });

  it("never includes JSON values in the content manifest diagnostic", () => {
    const root = mkdtempSync(join(tmpdir(), "uais-content-json-redaction-"));
    const privateValue = "private-json-value-must-not-escape";
    try {
      writeFileSync(
        join(root, "vercel.json"),
        JSON.stringify({ build: { env: { PRIVATE_VALUE: privateValue } } }),
      );

      const manifest = computeUaisStagingCandidateContentManifest(root, [
        "vercel.json",
      ]);

      expect(manifest.entries[0]).toMatchObject({
        path: "vercel.json",
        fileCount: 1,
        byteCount: expect.any(Number),
        jsonDiagnostic: {
          canonicalSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          topLevelKeys: ["build"],
          valuesRedacted: true,
        },
      });
      expect(JSON.stringify(manifest)).not.toContain(privateValue);

      writeFileSync(
        join(root, "vercel.json"),
        `${JSON.stringify(
          { build: { env: { PRIVATE_VALUE: privateValue } } },
          null,
          2,
        )}\n`,
      );
      const reformatted = computeUaisStagingCandidateContentManifest(root, [
        "vercel.json",
      ]);
      expect(reformatted.entries[0].sha256).not.toBe(
        manifest.entries[0].sha256,
      );
      expect(reformatted.entries[0].jsonDiagnostic?.canonicalSha256).toBe(
        manifest.entries[0].jsonDiagnostic?.canonicalSha256,
      );
      expect(JSON.stringify(reformatted)).not.toContain(privateValue);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the legacy aggregate framing stable for a fixed byte fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "uais-content-known-answer-"));
    try {
      mkdirSync(join(root, "nested"));
      writeFileSync(join(root, "alpha.txt"), "alpha\n");
      writeFileSync(join(root, "nested", "beta.bin"), Buffer.from([0, 1, 2, 3]));

      expect(
        computeUaisStagingCandidateContentSha(root, ["alpha.txt", "nested"]),
      ).toBe(
        "785b08014ac2e2ba5b05fd44b42f6d7a3f9cde9f31dedf9d9ca9439762016462",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed before any command outside the exact Vercel production scope", async () => {
    const commandRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedVercelStagingBuild({
      env: { ...safeStagingEnv, VERCEL_ENV: "preview" },
      commandRunner,
    });

    expect(result).toMatchObject({
      exitCode: 2,
      report: {
        target: "uais-isolated-staging-build",
        status: "BLOCKED_ENV",
        blockedReasons: ["vercel-production-scope-required"],
        valuesRedacted: true,
      },
    });
    expect(commandRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(dedicatedDatabaseUrl);
    expect(JSON.stringify(result)).not.toContain("staging-secret");
  });

  it.each([
    {
      label: "the production UAIS project",
      env: {
        ...safeStagingEnv,
        VERCEL_PROJECT_ID: "prj_MZIjawDPTU4tj4yuTBsd9hyLxHXA",
      },
      reason: "production-project-id-rejected",
    },
    {
      label: "an unknown Vercel project",
      env: { ...safeStagingEnv, VERCEL_PROJECT_ID: "prj_unknown" },
      reason: "isolated-staging-project-id-mismatch",
    },
    {
      label: "a non-staging UAIS deployment marker",
      env: { ...safeStagingEnv, UAIS_DEPLOYMENT_ENV: "production" },
      reason: "staging-deployment-marker-required",
    },
    {
      label: "disabled staging chatroom groups",
      env: { ...safeStagingEnv, UAIS_LEARNING_CHATROOM_GROUPS_MODE: "off" },
      reason: "staging-groups-mode-required",
    },
  ])("rejects $label before any command", async ({ env, reason }) => {
    const commandRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedVercelStagingBuild({ env, commandRunner });

    expect(result.exitCode).toBe(2);
    expect(result.report.blockedReasons).toEqual([reason]);
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "the alternate-config expiry attestation",
      env: { ...safeStagingEnv, UAIS_STAGING_CONFIG_ATTESTATION: undefined },
      reason: "staging-config-with-hourly-expiry-required",
    },
    {
      label: "a missing explicit RUM mode",
      env: { ...safeStagingEnv, UAIS_STAGING_INP_RUM_ENABLED: undefined },
      reason: "staging-inp-rum-mode-required",
    },
    {
      label: "an unknown RUM mode",
      env: { ...safeStagingEnv, UAIS_STAGING_INP_RUM_ENABLED: "maybe" },
      reason: "staging-inp-rum-mode-required",
    },
    {
      label: "the exact candidate SHA binding",
      env: { ...safeStagingEnv, P2_CANDIDATE_GIT_SHA: "b".repeat(40) },
      reason: "candidate-git-sha-mismatch",
    },
    {
      label: "the immutable deployment host",
      env: { ...safeStagingEnv, VERCEL_URL: "staging.uais.top" },
      reason: "immutable-deployment-host-invalid",
    },
    {
      label: "the candidate content digest",
      env: { ...safeStagingEnv, P2_CANDIDATE_CONTENT_SHA: "f".repeat(64) },
      reason: "candidate-content-sha-mismatch",
    },
    {
      label: "the candidate-bound cohort",
      env: { ...safeStagingEnv, UAIS_STAGING_INP_COHORT_ID: "p2-inp-current-run" },
      reason: "cohort-id-not-candidate-bound",
    },
    {
      label: "the cron secret",
      env: { ...safeStagingEnv, CRON_SECRET: undefined },
      reason: "cron-secret-missing-or-weak",
    },
    {
      label: "secret separation",
      env: {
        ...safeStagingEnv,
        CRON_SECRET: safeStagingEnv.UAIS_STAGING_INP_HMAC_SECRET,
      },
      reason: "staging-secret-reuse-rejected",
    },
  ])("rejects a build missing $label before database inspection", async ({ env, reason }) => {
    const commandRunner = vi.fn(() => ({ status: 0 }));
    const inspectTarget = vi.fn(async () => ({ approved: true }));

    const result = await runGuardedVercelStagingBuild({
      env,
      commandRunner,
      inspectTarget,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report.blockedReasons).toContain(reason);
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("reports only aggregate and per-entry hashes when Vercel changes build inputs", async () => {
    const wrongContentSha = "f".repeat(64);
    const result = await runGuardedVercelStagingBuild({
      env: { ...safeStagingEnv, P2_CANDIDATE_CONTENT_SHA: wrongContentSha },
      commandRunner: vi.fn(() => ({ status: 0 })),
      inspectTarget: vi.fn(async () => ({ approved: true })),
    });

    expect(result).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: expect.arrayContaining(["candidate-content-sha-mismatch"]),
        contentShaDiagnostic: {
          expectedSha256: wrongContentSha,
          computedSha256: candidateContentSha,
          entries: expect.arrayContaining([
            expect.objectContaining({
              path: "package-lock.json",
              fileCount: 1,
              sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
            expect.objectContaining({
              path: "src",
              fileCount: expect.any(Number),
              sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
          ]),
          valuesRedacted: true,
        },
        valuesRedacted: true,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(dedicatedDatabaseUrl);
    expect(serialized).not.toContain("staging-secret");
  });

  it("stays blocked when mismatch diagnostics throw or disagree with the aggregate", async () => {
    const computedSha = "e".repeat(64);
    const wrongExpectedSha = "f".repeat(64);
    const variants = [
      {
        computeContentManifest: () => {
          throw new Error("diagnostic-private-message");
        },
        expectedReasons: [
          "candidate-content-sha-mismatch",
          "candidate-content-sha-unverifiable",
        ],
      },
      {
        computeContentManifest: () => ({
          sha256: "d".repeat(64),
          entries: [
            {
              path: "private-path-must-not-be-used",
              fileCount: 1,
              sha256: "c".repeat(64),
            },
          ],
          valuesRedacted: true,
        }),
        expectedReasons: ["candidate-content-sha-mismatch"],
      },
    ];

    for (const variant of variants) {
      const inspectTarget = vi.fn(async () => ({ approved: true }));
      const commandRunner = vi.fn(() => ({ status: 0 }));
      const result = await runGuardedVercelStagingBuild({
        env: {
          ...safeStagingEnv,
          P2_CANDIDATE_CONTENT_SHA: wrongExpectedSha,
        },
        computeContentSha: () => computedSha,
        computeContentManifest: variant.computeContentManifest,
        inspectTarget,
        commandRunner,
        cwd: "/private-fixture-root",
      });

      expect(result.exitCode).toBe(2);
      expect(result.report.blockedReasons).toEqual(variant.expectedReasons);
      expect(inspectTarget).not.toHaveBeenCalled();
      expect(commandRunner).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("diagnostic-private-message");
      expect(JSON.stringify(result)).not.toContain("private-path-must-not-be-used");
    }
  });

  it.each([
    {
      label: "the candidate-bound cohort",
      env: { ...safeStagingEnv, UAIS_STAGING_INP_COHORT_ID: undefined },
      reason: "cohort-id-not-candidate-bound",
    },
    {
      label: "the HMAC secret",
      env: { ...safeStagingEnv, UAIS_STAGING_INP_HMAC_SECRET: undefined },
      reason: "hmac-secret-missing-or-weak",
    },
    {
      label: "the HMAC key version",
      env: { ...safeStagingEnv, UAIS_STAGING_INP_HMAC_KEY_VERSION: undefined },
      reason: "hmac-key-version-missing-or-invalid",
    },
    {
      label: "the approved operator allowlist",
      env: {
        ...safeStagingEnv,
        UAIS_STAGING_INP_OPERATOR_ACCOUNT_HASHES: undefined,
      },
      reason: "approved-operator-allowlist-missing",
    },
  ])("keeps RUM mode fail closed without $label", async ({ env, reason }) => {
    const commandRunner = vi.fn(() => ({ status: 0 }));
    const inspectTarget = vi.fn(async () => ({ approved: true }));

    const result = await runGuardedVercelStagingBuild({
      env,
      commandRunner,
      inspectTarget,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report.blockedReasons).toContain(reason);
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("permits an exact-candidate base staging build with RUM explicitly disabled", async () => {
    const commandRunner = vi.fn(() => ({ status: 0 }));
    const inspectTarget = vi.fn(async () => ({ approved: true }));

    const result = await runGuardedVercelStagingBuild({
      env: safeBaseStagingEnv,
      commandRunner,
      inspectTarget,
    });

    expect(result).toEqual({
      exitCode: 0,
      report: {
        target: "uais-isolated-staging-build",
        status: "PASS",
        blockedReasons: [],
        migrations: "applied",
        build: "completed",
        stagingInpRum: "disabled",
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).toHaveBeenCalledWith({ databaseUrl: dedicatedDatabaseUrl });
    expect(commandRunner).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: "the app-session secret",
      env: { ...safeBaseStagingEnv, UAIS_APP_SESSION_SIGNING_SECRET: undefined },
      reason: "session-secret-missing-or-weak",
    },
    {
      label: "the expiry cron secret",
      env: { ...safeBaseStagingEnv, CRON_SECRET: undefined },
      reason: "cron-secret-missing-or-weak",
    },
    {
      label: "the protection bypass secret",
      env: {
        ...safeBaseStagingEnv,
        P2_VERCEL_PROTECTION_BYPASS_SECRET: undefined,
      },
      reason: "protection-bypass-secret-missing-or-weak",
    },
  ])("keeps base staging fail closed without $label", async ({ env, reason }) => {
    const commandRunner = vi.fn(() => ({ status: 0 }));
    const inspectTarget = vi.fn(async () => ({ approved: true }));

    const result = await runGuardedVercelStagingBuild({
      env,
      commandRunner,
      inspectTarget,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report.blockedReasons).toContain(reason);
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "a missing dedicated staging database URL",
      env: { ...safeStagingEnv, UAIS_P2_STAGING_DATABASE_URL: " " },
      reason: "dedicated-staging-database-url-required",
    },
    {
      label: "a non-PostgreSQL dedicated database URL",
      env: {
        ...safeStagingEnv,
        UAIS_P2_STAGING_DATABASE_URL: "https://db.example.test/uais",
      },
      reason: "dedicated-staging-database-url-invalid",
    },
    ...["UAIS_CORE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"].map(
      (name) => ({
        label: `the generic ${name} alias`,
        env: {
          ...safeStagingEnv,
          [name]: "postgresql://generic-user:generic-secret@db.example.test/uais",
        },
        reason: `generic-database-url-rejected:${name}`,
      }),
    ),
  ])("rejects $label before any command", async ({ env, reason }) => {
    const commandRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedVercelStagingBuild({ env, commandRunner });

    expect(result.exitCode).toBe(2);
    expect(result.report.blockedReasons).toEqual([reason]);
    expect(commandRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("generic-secret");
  });

  it.each([
    {
      label: "a missing independent staging database identity",
      identity: " ",
      reason: "staging-database-identity-required",
    },
    {
      label: "the known production database identity",
      identity: "late-sunset-59152574",
      reason: "production-database-identity-rejected",
    },
  ])("rejects $label before any command", async ({ identity, reason }) => {
    const commandRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedVercelStagingBuild({
      env: {
        ...safeStagingEnv,
        NEON_PROJECT_ID: identity,
      },
      commandRunner,
    });

    expect(result.exitCode).toBe(2);
    expect(result.report.blockedReasons).toEqual([reason]);
    expect(commandRunner).not.toHaveBeenCalled();
    expect(result.report).not.toHaveProperty("databaseIdentity");
    expect(JSON.stringify(result)).not.toContain("late-sunset-59152574");
  });

  it("blocks before migrations when the connected database lacks the internal staging guard", async () => {
    const commandRunner = vi.fn(() => ({ status: 0 }));
    const inspectTarget = vi.fn(async () => ({ approved: false }));

    const result = await runGuardedVercelStagingBuild({
      env: safeStagingEnv,
      commandRunner,
      inspectTarget,
    });

    expect(result).toEqual({
      exitCode: 2,
      report: {
        target: "uais-isolated-staging-build",
        status: "BLOCKED_TARGET",
        blockedReasons: ["isolated-staging-database-guard-required"],
        requiredGuard: {
          table: "public.uais_environment_guard",
          environment: "isolated-p2-staging-source",
          enabled: true,
          sessionReplicationRole: "origin",
        },
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).toHaveBeenCalledWith({ databaseUrl: dedicatedDatabaseUrl });
    expect(commandRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(dedicatedDatabaseUrl);
  });

  it("reads the qualified guard table and requires origin replication mode", async () => {
    let observedQuery = "";
    const sql = Object.assign(
      vi.fn(async (strings: TemplateStringsArray) => {
        observedQuery = strings.join("?");
        return [
          {
            environment: "isolated-p2-staging-source",
            session_replication_role: "replica",
          },
        ];
      }),
      { end: vi.fn(async () => undefined) },
    );

    await expect(
      inspectStagingDatabaseTarget({
        databaseUrl: dedicatedDatabaseUrl,
        createClient: () => sql,
      }),
    ).resolves.toEqual({ approved: false });
    expect(observedQuery).toContain("FROM public.uais_environment_guard");
    expect(observedQuery).toContain("current_setting('session_replication_role')");
    expect(sql.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("runs strict core migrations against only the dedicated URL before the Next build", async () => {
    const commandRunner = vi.fn(() => ({ status: 0 }));
    const inspectTarget = vi.fn(async () => ({ approved: true }));

    const result = await runGuardedVercelStagingBuild({
      env: {
        ...safeStagingEnv,
        UAIS_CORE_DATABASE_URL: " ",
        DATABASE_URL: "",
        POSTGRES_URL: "\t",
        DEEPSEEK_API_KEY: "deepseek-build-output-secret-fixture-123456",
        UAIS_P2_STAGING_RESTORE_DATABASE_URL: restoreDatabaseUrl,
        RESTORE_NEON_PROJECT_ID: "restore-project-fixture",
        UAIS_DB_TEST_DATABASE_URL:
          "postgresql://db-test-user:db-test-secret@db-test.example.test/uais",
        UAIS_P1_LOAD_TEST_DATABASE_URL:
          "postgresql://load-user:load-secret@load.example.test/uais",
        RESTORE_DATABASE_URL: restoreDatabaseUrl,
        RESTORE_POSTGRES_URL: restoreDatabaseUrl,
        UAIS_CORE_DATABASE_REQUIRED_GUARD: "ambient-guard-must-not-reach-build",
      },
      commandRunner,
      inspectTarget,
      computeContentSha: () => candidateContentSha,
      cwd: "/repo-fixture",
      nodeExecutable: "/node-fixture",
    });

    expect(result).toEqual({
      exitCode: 0,
      report: {
        target: "uais-isolated-staging-build",
        status: "PASS",
        blockedReasons: [],
        migrations: "applied",
        build: "completed",
        stagingInpRum: "enabled",
        valuesRedacted: true,
      },
    });
    expect(commandRunner).toHaveBeenCalledTimes(2);
    expect(inspectTarget).toHaveBeenCalledWith({ databaseUrl: dedicatedDatabaseUrl });

    const migrationInvocation = commandRunner.mock.calls[0]?.[0];
    const buildInvocation = commandRunner.mock.calls[1]?.[0];

    expect(migrationInvocation).toMatchObject({
      label: "core-migrations",
      command: "/node-fixture",
      args: ["scripts/apply-core-migrations.mjs"],
      cwd: "/repo-fixture",
    });
    expect(migrationInvocation.env.UAIS_CORE_DATABASE_URL).toBe(
      dedicatedDatabaseUrl,
    );
    expect(migrationInvocation.env.UAIS_CORE_DATABASE_REQUIRED_GUARD).toBe(
      "isolated-p2-staging-source",
    );
    expect(migrationInvocation.env).not.toHaveProperty("DATABASE_URL");
    expect(migrationInvocation.env).not.toHaveProperty("POSTGRES_URL");
    expect(migrationInvocation.env).not.toHaveProperty(
      "UAIS_P2_STAGING_DATABASE_URL",
    );
    expect(migrationInvocation.env).not.toHaveProperty(
      "UAIS_STAGING_INP_HMAC_SECRET",
    );
    expect(migrationInvocation.env).not.toHaveProperty("CRON_SECRET");
    expect(migrationInvocation.env).not.toHaveProperty(
      "P2_VERCEL_PROTECTION_BYPASS_SECRET",
    );

    expect(buildInvocation).toMatchObject({
      label: "next-build",
      command: "/node-fixture",
      args: ["node_modules/next/dist/bin/next", "build"],
      cwd: "/repo-fixture",
    });
    expect(buildInvocation.env).not.toHaveProperty("UAIS_CORE_DATABASE_URL");
    expect(buildInvocation.env).not.toHaveProperty("DATABASE_URL");
    expect(buildInvocation.env).not.toHaveProperty("POSTGRES_URL");
    for (const name of [
      "UAIS_P2_STAGING_RESTORE_DATABASE_URL",
      "RESTORE_NEON_PROJECT_ID",
      "UAIS_DB_TEST_DATABASE_URL",
      "UAIS_P1_LOAD_TEST_DATABASE_URL",
      "RESTORE_DATABASE_URL",
      "RESTORE_POSTGRES_URL",
      "UAIS_CORE_DATABASE_REQUIRED_GUARD",
    ]) {
      expect(buildInvocation.env).not.toHaveProperty(name);
    }
    expect(buildInvocation.env.UAIS_P2_STAGING_DATABASE_URL).toBe(
      dedicatedDatabaseUrl,
    );
    expect(buildInvocation.redactValues).toEqual(
      expect.arrayContaining([
        dedicatedDatabaseUrl,
        "deepseek-build-output-secret-fixture-123456",
      ]),
    );
    expect(getUaisCoreDatabaseReadiness(buildInvocation.env)).toMatchObject({
      status: "ready",
      selectedEnvName: UAIS_ISOLATED_STAGING_CORE_DATABASE_ENV_NAME,
    });

    expect(JSON.stringify(result)).not.toContain(dedicatedDatabaseUrl);
    expect(JSON.stringify(result)).not.toContain("neon-staging-project-fixture");
  });

  it("does not start the Next build when core migrations fail", async () => {
    const commandRunner = vi.fn(() => ({ status: 7 }));

    const result = await runGuardedVercelStagingBuild({
      env: safeStagingEnv,
      commandRunner,
      inspectTarget: vi.fn(async () => ({ approved: true })),
    });

    expect(result).toEqual({
      exitCode: 1,
      report: {
        target: "uais-isolated-staging-build",
        status: "FAIL",
        blockedReasons: ["core-migrations-failed"],
        valuesRedacted: true,
      },
    });
    expect(commandRunner).toHaveBeenCalledTimes(1);
    expect(commandRunner.mock.calls[0]?.[0]).toMatchObject({
      label: "core-migrations",
    });
    expect(JSON.stringify(result)).not.toContain(dedicatedDatabaseUrl);
  });

  it("redacts all secret-like values inherited by the full Next build child", () => {
    const secretEnv = {
      ...safeStagingEnv,
      DEEPSEEK_API_KEY: "deepseek-provider-secret-fixture-123456",
      DASHSCOPE_API_KEY: "dashscope-provider-secret-fixture-123456",
      DIRECTMAIL_ACCESS_KEY_SECRET: "directmail-secret-fixture-1234567890",
      UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN: "oss-access-token-fixture-1234567890",
      UAIS_LRS_BASIC_AUTH_PASSWORD: "lrs-password-fixture-123456789012345",
      SENTRY_AUTH_TOKEN: "sentry-auth-token-fixture-123456789012",
      UAIS_P2_STAGING_RESTORE_DATABASE_URL:
        "postgresql://restore-user:restore-password@restore.example.test/uais",
    };
    const expectedSecrets = [
      secretEnv.DEEPSEEK_API_KEY,
      secretEnv.DASHSCOPE_API_KEY,
      secretEnv.DIRECTMAIL_ACCESS_KEY_SECRET,
      secretEnv.UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN,
      secretEnv.UAIS_LRS_BASIC_AUTH_PASSWORD,
      secretEnv.SENTRY_AUTH_TOKEN,
      secretEnv.UAIS_P2_STAGING_RESTORE_DATABASE_URL,
    ];

    const redactValues = readStagingRedactionValues(secretEnv);
    expect(redactValues).toEqual(expect.arrayContaining(expectedSecrets));

    const output = redactStagingChildOutput(
      expectedSecrets.join("\n"),
      redactValues,
    );
    for (const secret of expectedSecrets) expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("[REDACTED_POSTGRES_DSN]");
  });

  it("fails closed through the executable CLI before any unsafe build can start", async () => {
    const guardEnvNames = new Set([
      "VERCEL_ENV",
      "VERCEL_PROJECT_ID",
      "UAIS_DEPLOYMENT_ENV",
      "UAIS_LEARNING_CHATROOM_GROUPS_MODE",
      "UAIS_P2_STAGING_DATABASE_URL",
      "NEON_PROJECT_ID",
      "UAIS_CORE_DATABASE_URL",
      "DATABASE_URL",
      "POSTGRES_URL",
    ]);
    const isolatedEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !guardEnvNames.has(name)),
    );

    let outcome: { code: number; stdout: string; stderr: string };
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        ["scripts/vercel-staging-build-guard.mjs"],
        { cwd: process.cwd(), env: isolatedEnv as NodeJS.ProcessEnv },
      );
      outcome = { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      outcome = {
        code: failure.code ?? 1,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
      };
    }

    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toBe("");
    expect(JSON.parse(outcome.stdout.trim())).toMatchObject({
      target: "uais-isolated-staging-build",
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining([
        "vercel-production-scope-required",
        "isolated-staging-project-id-mismatch",
        "staging-deployment-marker-required",
        "staging-groups-mode-required",
        "dedicated-staging-database-url-required",
        "staging-database-identity-required",
      ]),
      valuesRedacted: true,
    });
  });

  it("binds the staging Vercel config to the guarded wrapper, never the generic build", () => {
    const stagingConfigSource = readFileSync("vercel.staging.json", "utf8");
    const stagingConfig = JSON.parse(stagingConfigSource) as {
      buildCommand?: string;
      build?: { env?: Record<string, string> };
    };

    expect(stagingConfig.buildCommand).toBe(
      "node scripts/vercel-staging-build-guard.mjs",
    );
    expect(stagingConfigSource).not.toContain("npm run vercel-build");
    expect(stagingConfig.build?.env).toEqual({
      UAIS_STAGING_CONFIG_ATTESTATION,
    });
    const productionConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      build?: { env?: Record<string, string> };
    };
    expect(productionConfig.build?.env).toBeUndefined();
  });
});
