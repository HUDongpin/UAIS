import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createDbTestDsnFingerprint,
  LIVE_MUTATION_CONFIRMATION,
  inspectDatabaseTarget,
  runGuardedDatabaseTests,
} from "../scripts/run-db-tests.mjs";
import { LIVE_DB_TEST_FILES } from "../scripts/live-db-test-contract.mjs";

const dedicatedDatabaseUrl =
  "postgresql://db-test-user:db-test-secret@db-test.example.test/uais_test";
const isolatedNeonProjectId = "isolated-db-test-project";
const fingerprintNonce =
  "fixture-nonce-with-at-least-thirty-two-characters";
const legacyTestFiles = [
  "tests/teaching-course-management-postgres-integration.test.ts",
  "tests/teacher-ai-ownership-postgres-integration.test.ts",
  "tests/learning-chatroom-postgres-integration.test.ts",
  "tests/uais-app-account-postgres-integration.test.ts",
  "tests/teaching-course-management-cutover-integration.test.ts",
  "tests/teaching-operations-cutover-integration.test.ts",
  "tests/learning-loop-postgres-integration.test.ts",
  "tests/teaching-course-collaborator-postgres-integration.test.ts",
];
const legacyExpectedTests = 26;
const inpTestFile = "tests/staging-inp-rum-postgres-integration.test.ts";

function createValidGuardEnv(
  overrides: Record<string, string | undefined> = {},
) {
  const databaseUrl =
    overrides.UAIS_DB_TEST_DATABASE_URL ?? dedicatedDatabaseUrl;
  const neonProjectId =
    overrides.UAIS_DB_TEST_NEON_PROJECT_ID ?? isolatedNeonProjectId;
  const nonce =
    overrides.UAIS_DB_TEST_DSN_FINGERPRINT_NONCE ?? fingerprintNonce;

  return {
    UAIS_DB_TEST_DATABASE_URL: databaseUrl,
    UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION: LIVE_MUTATION_CONFIRMATION,
    UAIS_DB_TEST_NEON_PROJECT_ID: neonProjectId,
    UAIS_DB_TEST_DSN_FINGERPRINT_NONCE: nonce,
    UAIS_DB_TEST_DSN_FINGERPRINT: createDbTestDsnFingerprint({
      databaseUrl,
      neonProjectId,
      nonce,
    }),
    ...overrides,
  };
}

describe("guarded Postgres integration lane", () => {
  it("blocks a dedicated URL alone before any database connection or test runner", async () => {
    const inspectTarget = vi.fn();
    const testRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedDatabaseTests({
      env: { UAIS_DB_TEST_DATABASE_URL: dedicatedDatabaseUrl },
      inspectTarget,
      testRunner,
    });

    expect(result).toEqual({
      exitCode: 2,
      report: {
        target: "uais-postgres-integration-lane",
        status: "BLOCKED_ENV",
        blockedReasons: [
          "live-mutation-confirmation-required",
          "non-production-neon-project-id-required",
          "dsn-fingerprint-nonce-required",
          "dsn-fingerprint-required",
        ],
        acceptedDatabaseEnvName: "UAIS_DB_TEST_DATABASE_URL",
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(testRunner).not.toHaveBeenCalled();

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(dedicatedDatabaseUrl);
    expect(serialized).not.toContain("db-test-secret");
    expect(serialized).not.toContain("db-test.example.test");
  });

  it("rejects a mismatched normalized DSN fingerprint before connecting", async () => {
    const inspectTarget = vi.fn(async () => ({ approved: true }));
    const testRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv({
        UAIS_DB_TEST_DSN_FINGERPRINT: `sha256:${"0".repeat(64)}`,
      }),
      inspectTarget,
      testRunner,
    });

    expect(result).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["dsn-fingerprint-mismatch"],
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(testRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(dedicatedDatabaseUrl);
    expect(JSON.stringify(result)).not.toContain("db-test-secret");
  });

  it("uses the public guard table and rejects a non-origin replication role", async () => {
    let observedQuery = "";
    const sql = Object.assign(
      vi.fn(
        async (strings: TemplateStringsArray) => {
          observedQuery = strings.join("?");
          return [
            {
              environment: "isolated-uais-db-test",
              session_replication_role: "replica",
            },
          ];
        },
      ),
      { end: vi.fn(async () => undefined) },
    );
    const createClient = vi.fn(() => sql);

    const inspection = await inspectDatabaseTarget({
      databaseUrl: dedicatedDatabaseUrl,
      createClient,
    });

    expect(inspection).toEqual({ approved: false });
    expect(observedQuery).toContain("FROM public.uais_environment_guard");
    expect(observedQuery).toContain("isolated-uais-db-test");
    expect(observedQuery).toContain("isolated-p2-staging-source");
    expect(observedQuery).toContain(
      "current_setting('session_replication_role')",
    );
    expect(sql.end).toHaveBeenCalledWith({ timeout: 5 });
    expect(JSON.stringify(inspection)).not.toContain(dedicatedDatabaseUrl);
    expect(JSON.stringify(inspection)).not.toContain("db-test-secret");
  });

  it("requires both DB-test and staging-INP marker rows before any lane can mutate", async () => {
    const sql = Object.assign(
      vi.fn(async () => [
        {
          environment: "isolated-uais-db-test",
          session_replication_role: "origin",
        },
        {
          environment: "isolated-p2-staging-source",
          session_replication_role: "origin",
        },
      ]),
      { end: vi.fn(async () => undefined) },
    );

    await expect(
      inspectDatabaseTarget({
        databaseUrl: dedicatedDatabaseUrl,
        createClient: () => sql,
      }),
    ).resolves.toEqual({ approved: true });

    sql.mockResolvedValueOnce([
      {
        environment: "isolated-uais-db-test",
        session_replication_role: "origin",
      },
    ]);
    await expect(
      inspectDatabaseTarget({
        databaseUrl: dedicatedDatabaseUrl,
        createClient: () => sql,
      }),
    ).resolves.toEqual({ approved: false });
  });

  it("rejects generic database aliases even when the dedicated identity is valid", async () => {
    const inspectTarget = vi.fn(async () => ({ approved: true }));
    const testRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv({
        DATABASE_URL:
          "postgresql://production-user:production-secret@production.example.test/uais",
      }),
      inspectTarget,
      testRunner,
    });

    expect(result).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["generic-database-url-rejected:DATABASE_URL"],
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(testRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("production-secret");
    expect(JSON.stringify(result)).not.toContain("production.example.test");
  });

  it("fails closed when the DSN cannot be safely normalized", async () => {
    const databaseUrl =
      "postgresql://db-test-user:db-test-secret@db-test.example.test/%E0%A4%A";
    const inspectTarget = vi.fn();
    const testRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedDatabaseTests({
      env: {
        UAIS_DB_TEST_DATABASE_URL: databaseUrl,
        UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION: LIVE_MUTATION_CONFIRMATION,
        UAIS_DB_TEST_NEON_PROJECT_ID: "isolated-db-test-project",
        UAIS_DB_TEST_DSN_FINGERPRINT_NONCE:
          "fixture-nonce-with-at-least-thirty-two-characters",
        UAIS_DB_TEST_DSN_FINGERPRINT: `sha256:${"0".repeat(64)}`,
      },
      inspectTarget,
      testRunner,
    });

    expect(result).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["dsn-fingerprint-normalization-failed"],
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(testRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(databaseUrl);
    expect(JSON.stringify(result)).not.toContain("db-test-secret");
  });

  it("explicitly rejects the production Neon project identity", async () => {
    const productionNeonProjectId = "late-sunset-59152574";
    const inspectTarget = vi.fn();
    const testRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv({
        UAIS_DB_TEST_NEON_PROJECT_ID: productionNeonProjectId,
      }),
      inspectTarget,
      testRunner,
    });

    expect(result).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["production-neon-project-id-rejected"],
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(testRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(productionNeonProjectId);
    expect(JSON.stringify(result)).not.toContain(dedicatedDatabaseUrl);
  });

  it("requires the live-mutation confirmation value to match exactly", async () => {
    const inspectTarget = vi.fn();
    const testRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv({
        UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION: `${LIVE_MUTATION_CONFIRMATION} `,
      }),
      inspectTarget,
      testRunner,
    });

    expect(result).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["live-mutation-confirmation-required"],
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(testRunner).not.toHaveBeenCalled();
  });

  it("runs only after every environment and database guard is satisfied", async () => {
    const fingerprint = createDbTestDsnFingerprint({
      databaseUrl: dedicatedDatabaseUrl,
      neonProjectId: isolatedNeonProjectId,
      nonce: fingerprintNonce,
    });
    const inspectTarget = vi.fn(async () => ({ approved: true }));
    const testRunner = vi.fn((input: { lane: string }) => {
      if (input.lane === "legacy") {
        return createPassingVitestResult(legacyTestFiles, legacyExpectedTests);
      }
      if (input.lane === "staging-inp") {
        return createPassingVitestResult([inpTestFile], 2);
      }
      return { status: 1, stdout: "", stderr: "" };
    });

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv({
        UAIS_DETERMINISTIC_DB_SKIP: "run-deterministic-tests",
        UNRELATED_PROVIDER_SECRET: "must-not-reach-db-test-children",
      }),
      inspectTarget,
      testRunner,
      cwd: "/repo-fixture",
      nodeExecutable: "/node-fixture",
    });

    expect(result).toEqual({
      exitCode: 0,
      report: {
        target: "uais-postgres-integration-lane",
        status: "PASS",
        blockedReasons: [],
        selectedEnvName: "UAIS_DB_TEST_DATABASE_URL",
        lanes: [
          {
            id: "legacy",
            testFiles: legacyTestFiles,
            expectedTests: legacyExpectedTests,
            passedTests: legacyExpectedTests,
            skippedTests: 0,
          },
          {
            id: "staging-inp",
            testFiles: [inpTestFile],
            expectedTests: 2,
            passedTests: 2,
            skippedTests: 0,
          },
        ],
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).toHaveBeenCalledWith({
      databaseUrl: dedicatedDatabaseUrl,
    });
    expect(testRunner).toHaveBeenCalledTimes(2);
    const legacyInvocation = testRunner.mock.calls[0]?.[0];
    const inpInvocation = testRunner.mock.calls[1]?.[0];
    expect(legacyInvocation).toMatchObject({
      lane: "legacy",
      command: "/node-fixture",
      cwd: "/repo-fixture",
    });
    expect(legacyInvocation.args).toEqual([
      "node_modules/vitest/vitest.mjs",
      "run",
      "--no-file-parallelism",
      "--silent",
      "--reporter=json",
      ...legacyTestFiles,
    ]);
    expect(legacyInvocation.env.UAIS_DB_TEST_DATABASE_URL).toBe(
      dedicatedDatabaseUrl,
    );
    expect(legacyInvocation.env.UAIS_CORE_DATABASE_URL).toBe(
      dedicatedDatabaseUrl,
    );
    expect(legacyInvocation.env.UAIS_CORE_DATABASE_REQUIRED_GUARD).toBe(
      "isolated-uais-db-test",
    );
    expect(legacyInvocation.env).not.toHaveProperty("DATABASE_URL");
    expect(legacyInvocation.env).not.toHaveProperty("POSTGRES_URL");
    expect(legacyInvocation.env).not.toHaveProperty(
      "UAIS_DETERMINISTIC_DB_SKIP",
    );
    expect(legacyInvocation.env).not.toHaveProperty("UNRELATED_PROVIDER_SECRET");

    expect(inpInvocation).toMatchObject({
      lane: "staging-inp",
      command: "/node-fixture",
      cwd: "/repo-fixture",
    });
    expect(inpInvocation.args).toEqual([
      "node_modules/vitest/vitest.mjs",
      "run",
      "--no-file-parallelism",
      "--silent",
      "--reporter=json",
      inpTestFile,
    ]);
    expect(inpInvocation.env.UAIS_DB_TEST_DATABASE_URL).toBe(
      dedicatedDatabaseUrl,
    );
    expect(inpInvocation.env).not.toHaveProperty("UAIS_CORE_DATABASE_URL");
    expect(inpInvocation.env).not.toHaveProperty(
      "UAIS_CORE_DATABASE_REQUIRED_GUARD",
    );
    expect(inpInvocation.env).not.toHaveProperty("DATABASE_URL");
    expect(inpInvocation.env).not.toHaveProperty("POSTGRES_URL");
    expect(inpInvocation.env).not.toHaveProperty(
      "UAIS_DETERMINISTIC_DB_SKIP",
    );
    expect(inpInvocation.env).not.toHaveProperty("UNRELATED_PROVIDER_SECRET");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(dedicatedDatabaseUrl);
    expect(serialized).not.toContain("db-test-secret");
    expect(serialized).not.toContain(isolatedNeonProjectId);
    expect(serialized).not.toContain(fingerprintNonce);
    expect(serialized).not.toContain(fingerprint);
  });

  it("mints a fresh short-lived capability for each dedicated child and removes it afterward", async () => {
    const observedCapabilities: Array<{
      file: string;
      token: string;
      lane: string;
    }> = [];
    const testRunner = vi.fn(
      (input: { lane: string; env: Record<string, string> }) => {
        const file = input.env.UAIS_LIVE_DB_TEST_CAPABILITY_FILE;
        const token = input.env.UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN;
        const lane = input.env.UAIS_LIVE_DB_TEST_CAPABILITY_LANE;
        expect(file).toBeTruthy();
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(lane).toBe(input.lane);
        expect(existsSync(file)).toBe(true);
        expect(statSync(file).mode & 0o077).toBe(0);
        const receipt = JSON.parse(readFileSync(file, "utf8"));
        expect(receipt).toMatchObject({ version: 1, lane: input.lane });
        expect(receipt.tokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(receipt.tokenHash).not.toBe(token);
        expect(receipt.expiresAt).toBeGreaterThan(Date.now());
        observedCapabilities.push({ file, token, lane });

        return input.lane === "legacy"
          ? createPassingVitestResult(legacyTestFiles, legacyExpectedTests)
          : createPassingVitestResult([inpTestFile], 2);
      },
    );

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv({
        UAIS_LIVE_DB_TEST_CAPABILITY_FILE: "/tmp/ambient-capability.json",
        UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN: "a".repeat(43),
        UAIS_LIVE_DB_TEST_CAPABILITY_LANE: "ambient",
      }),
      inspectTarget: vi.fn(async () => ({ approved: true })),
      testRunner,
    });

    expect(result.exitCode).toBe(0);
    expect(observedCapabilities).toHaveLength(2);
    expect(new Set(observedCapabilities.map(({ file }) => file)).size).toBe(2);
    expect(new Set(observedCapabilities.map(({ token }) => token)).size).toBe(2);
    for (const { file } of observedCapabilities) {
      expect(existsSync(file)).toBe(false);
    }
  });

  it("keeps the parent temp root in the minimized env so a real child can validate and then lose its capability", async () => {
    const capabilityFiles: string[] = [];
    const probeOutputs: string[] = [];
    const testRunner = vi.fn(
      (input: { lane: string; env: NodeJS.ProcessEnv }) => {
        for (const tempName of ["TMPDIR", "TMP", "TEMP"] as const) {
          if (typeof process.env[tempName] === "string") {
            expect(input.env[tempName]).toBe(process.env[tempName]);
          }
        }
        capabilityFiles.push(
          input.env.UAIS_LIVE_DB_TEST_CAPABILITY_FILE ?? "",
        );
        const testFile =
          input.lane === "legacy" ? legacyTestFiles[0] : inpTestFile;
        const probe = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            [
              'import { validateLiveDatabaseTestCapability } from "./scripts/run-db-tests.mjs";',
              `const result = validateLiveDatabaseTestCapability({ env: process.env, lane: ${JSON.stringify(input.lane)}, testFile: ${JSON.stringify(testFile)}, now: Date.now() });`,
              "process.stdout.write(JSON.stringify(result));",
              "if (result.approved !== true) process.exitCode = 2;",
            ].join("\n"),
          ],
          { cwd: process.cwd(), env: input.env, encoding: "utf8" },
        );
        expect(probe.status).toBe(0);
        expect(probe.stderr).toBe("");
        expect(JSON.parse(probe.stdout)).toEqual({ approved: true });
        probeOutputs.push(probe.stdout);
        return input.lane === "legacy"
          ? createPassingVitestResult(legacyTestFiles, legacyExpectedTests)
          : createPassingVitestResult([inpTestFile], 2);
      },
    );

    const runtimeTempEnvironment = Object.fromEntries(
      (["TMPDIR", "TMP", "TEMP"] as const).flatMap((name) =>
        typeof process.env[name] === "string"
          ? [[name, process.env[name]]]
          : [],
      ),
    );
    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv(runtimeTempEnvironment),
      inspectTarget: vi.fn(async () => ({ approved: true })),
      testRunner,
    });

    expect(result.exitCode).toBe(0);
    expect(capabilityFiles).toHaveLength(2);
    for (const file of capabilityFiles) expect(existsSync(file)).toBe(false);
    const serializedProbeOutput = probeOutputs.join("\n");
    expect(serializedProbeOutput).not.toContain(dedicatedDatabaseUrl);
    expect(serializedProbeOutput).not.toContain("db-test-secret");
    expect(serializedProbeOutput).not.toContain(isolatedNeonProjectId);
  }, 30_000);

  it("does not invoke the runner when the database guard is not approved", async () => {
    const testRunner = vi.fn(() => ({ status: 0 }));

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv(),
      inspectTarget: vi.fn(async () => ({ approved: false })),
      testRunner,
    });

    expect(result).toEqual({
      exitCode: 2,
      report: {
        target: "uais-postgres-integration-lane",
        status: "BLOCKED_TARGET",
        blockedReasons: ["isolated-db-test-guards-required"],
        requiredGuards: [
          {
            table: "public.uais_environment_guard",
            environment: "isolated-uais-db-test",
            enabled: true,
            sessionReplicationRole: "origin",
          },
          {
            table: "public.uais_environment_guard",
            environment: "isolated-p2-staging-source",
            enabled: true,
            sessionReplicationRole: "origin",
          },
        ],
        valuesRedacted: true,
      },
    });
    expect(testRunner).not.toHaveBeenCalled();
  });

  it("fails the dedicated lane when Vitest reports even one skipped live test", async () => {
    const testRunner = vi.fn((input: { lane: string }) => {
      if (input.lane === "legacy") {
        return createPassingVitestResult(legacyTestFiles, legacyExpectedTests);
      }
      const result = createPassingVitestResult([inpTestFile], 2);
      const body = JSON.parse(result.stdout);
      body.numPassedTests = 1;
      body.numPendingTests = 1;
      body.testResults[0].assertionResults[1].status = "skipped";
      return { ...result, stdout: JSON.stringify(body) };
    });

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv(),
      inspectTarget: vi.fn(async () => ({ approved: true })),
      testRunner,
    });

    expect(result).toEqual({
      exitCode: 1,
      report: {
        target: "uais-postgres-integration-lane",
        status: "FAIL",
        blockedReasons: ["staging-inp-live-tests-skipped"],
        selectedEnvName: "UAIS_DB_TEST_DATABASE_URL",
        completedLanes: [
          {
            id: "legacy",
            testFiles: legacyTestFiles,
            expectedTests: legacyExpectedTests,
            passedTests: legacyExpectedTests,
            skippedTests: 0,
          },
        ],
        valuesRedacted: true,
      },
    });
    expect(testRunner).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(dedicatedDatabaseUrl);
    expect(JSON.stringify(result)).not.toContain("db-test-secret");
  });

  it("fails closed when a child exits zero without a parseable Vitest JSON receipt", async () => {
    const testRunner = vi.fn(() => ({
      status: 0,
      stdout: "not-json",
      stderr: "fixture stderr must not be copied into the report",
    }));

    const result = await runGuardedDatabaseTests({
      env: createValidGuardEnv(),
      inspectTarget: vi.fn(async () => ({ approved: true })),
      testRunner,
    });

    expect(result).toEqual({
      exitCode: 1,
      report: {
        target: "uais-postgres-integration-lane",
        status: "FAIL",
        blockedReasons: ["legacy-vitest-json-invalid"],
        selectedEnvName: "UAIS_DB_TEST_DATABASE_URL",
        completedLanes: [],
        valuesRedacted: true,
      },
    });
    expect(testRunner).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("fixture stderr");
  });

  it("blocks direct Vitest execution of every live-DB file instead of skipping it", () => {
    const env = { ...process.env };
    for (const name of [
      "UAIS_DB_TEST_DATABASE_URL",
      "UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION",
      "UAIS_DB_TEST_NEON_PROJECT_ID",
      "UAIS_DB_TEST_DSN_FINGERPRINT_NONCE",
      "UAIS_DB_TEST_DSN_FINGERPRINT",
      "UAIS_CORE_DATABASE_URL",
      "UAIS_P1_LOAD_TEST_DATABASE_URL",
      "DATABASE_URL",
      "POSTGRES_URL",
      "UAIS_LIVE_DB_TEST_CAPABILITY_FILE",
      "UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN",
      "UAIS_LIVE_DB_TEST_CAPABILITY_LANE",
    ]) {
      delete env[name];
    }

    for (const testFile of LIVE_DB_TEST_FILES) {
      const outcome = spawnSync(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--no-file-parallelism",
          testFile,
        ],
        { cwd: process.cwd(), env, encoding: "utf8" },
      );

      expect(outcome.status, testFile).not.toBe(0);
      expect(`${outcome.stdout}\n${outcome.stderr}`, testFile).toContain(
        "BLOCKED_ENV",
      );
    }
  }, 90_000);

  it("rejects URL-only ambient execution for all ten live-DB files before any connection", () => {
    const env = { ...process.env };
    for (const name of [
      "UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION",
      "UAIS_DB_TEST_NEON_PROJECT_ID",
      "UAIS_DB_TEST_DSN_FINGERPRINT_NONCE",
      "UAIS_DB_TEST_DSN_FINGERPRINT",
      "UAIS_LIVE_DB_TEST_CAPABILITY_FILE",
      "UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN",
      "UAIS_LIVE_DB_TEST_CAPABILITY_LANE",
    ]) {
      delete env[name];
    }
    const fixtureUrl =
      "postgresql://ambient-user:ambient-secret@ambient.invalid/uais";
    Object.assign(env, {
      UAIS_DB_TEST_DATABASE_URL: fixtureUrl,
      UAIS_P1_LOAD_TEST_DATABASE_URL: fixtureUrl,
      UAIS_CORE_DATABASE_URL: fixtureUrl,
      DATABASE_URL: fixtureUrl,
      POSTGRES_URL: fixtureUrl,
    });

    for (const testFile of LIVE_DB_TEST_FILES) {
      const outcome = spawnSync(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--no-file-parallelism",
          testFile,
        ],
        { cwd: process.cwd(), env, encoding: "utf8" },
      );
      const output = `${outcome.stdout}\n${outcome.stderr}`;

      expect(outcome.status, testFile).not.toBe(0);
      expect(output, testFile).toContain("BLOCKED_ENV");
      expect(output, testFile).toContain(
        "dedicated-runner-capability-required",
      );
      expect(output, testFile).not.toContain(fixtureUrl);
      expect(output, testFile).not.toContain("ambient-secret");
      expect(output, testFile).not.toMatch(/ECONN|ENOTFOUND|connect timeout/i);
    }
  }, 90_000);

  it("reports an empty real CLI environment as BLOCKED_ENV with exit 2", () => {
    const outcome = spawnSync(process.execPath, ["scripts/run-db-tests.mjs"], {
      cwd: process.cwd(),
      env: {},
      encoding: "utf8",
    });

    expect(outcome.status).toBe(2);
    expect(outcome.stdout).toBe("");
    const report = JSON.parse(outcome.stderr.trim());
    expect(report).toMatchObject({
      target: "uais-postgres-integration-lane",
      status: "BLOCKED_ENV",
      blockedReasons: expect.arrayContaining([
        "dedicated-db-test-database-url-required",
        "live-mutation-confirmation-required",
        "non-production-neon-project-id-required",
        "dsn-fingerprint-nonce-required",
        "dsn-fingerprint-required",
      ]),
      valuesRedacted: true,
    });
    expect(outcome.stderr).not.toMatch(/PASS|skip/i);
    expect(outcome.stderr).not.toContain("postgres://");
    expect(outcome.stderr).not.toContain("postgresql://");
  });

  it("normalizes target identity without hashing passwords or query options", () => {
    const first = createDbTestDsnFingerprint({
      databaseUrl:
        "postgres://db-test-user:first-secret@DB-TEST.EXAMPLE.TEST/uais_test?sslmode=require",
      neonProjectId: isolatedNeonProjectId,
      nonce: fingerprintNonce,
    });
    const second = createDbTestDsnFingerprint({
      databaseUrl:
        "postgresql://db-test-user:second-secret@db-test.example.test:5432/uais_test?channel_binding=require",
      neonProjectId: isolatedNeonProjectId,
      nonce: fingerprintNonce,
    });
    const differentDatabase = createDbTestDsnFingerprint({
      databaseUrl:
        "postgresql://db-test-user:second-secret@db-test.example.test:5432/other_test",
      neonProjectId: isolatedNeonProjectId,
      nonce: fingerprintNonce,
    });

    expect(first).toBe(second);
    expect(first).not.toBe(differentDatabase);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first).not.toContain("first-secret");
    expect(first).not.toContain("db-test.example.test");
  });
});

function createPassingVitestResult(testFiles: string[], totalTests: number) {
  const perFile = Math.floor(totalTests / testFiles.length);
  let remaining = totalTests;
  const testResults = testFiles.map((testFile, index) => {
    const count =
      index === testFiles.length - 1 ? remaining : Math.max(1, perFile);
    remaining -= count;
    return {
      assertionResults: Array.from({ length: count }, (_, assertionIndex) => ({
        status: "passed",
        title: `fixture-${assertionIndex + 1}`,
      })),
      status: "passed",
      name: `/repo-fixture/${testFile}`,
    };
  });
  return {
    status: 0,
    stdout: JSON.stringify({
      numTotalTests: totalTests,
      numPassedTests: totalTests,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults,
    }),
    stderr: "",
  };
}
