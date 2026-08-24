import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeP1LoadTestTarget,
  createDbTestDsnFingerprint,
  inspectP1LoadDatabaseTarget,
  LIVE_MUTATION_CONFIRMATION,
  resolveLiveDatabaseTestInspector,
} from "../scripts/run-db-tests.mjs";
import { runGuardedP1LoadTest } from "../scripts/run-p1-load-test.mjs";

const p1DatabaseUrl =
  "postgresql://p1-load-user:p1-load-secret@p1-load.example.test/uais_load";
const p1NeonProjectId = "isolated-p1-load-project";
const p1FingerprintNonce =
  "p1-load-fixture-nonce-with-at-least-thirty-two-characters";

function createValidP1Environment(
  overrides: Record<string, string | undefined> = {},
) {
  const databaseUrl =
    overrides.UAIS_P1_LOAD_TEST_DATABASE_URL ?? p1DatabaseUrl;
  const neonProjectId =
    overrides.UAIS_DB_TEST_NEON_PROJECT_ID ?? p1NeonProjectId;
  const nonce =
    overrides.UAIS_DB_TEST_DSN_FINGERPRINT_NONCE ?? p1FingerprintNonce;
  return {
    UAIS_P1_LOAD_TEST_DATABASE_URL: databaseUrl,
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

describe("guarded P1 Postgres load lane", () => {
  it("reports missing dedicated configuration as BLOCKED_ENV before connecting", () => {
    const outcome = spawnSync(
      process.execPath,
      ["scripts/run-p1-load-test.mjs"],
      { cwd: process.cwd(), env: {}, encoding: "utf8" },
    );

    expect(outcome.status).toBe(2);
    expect(outcome.stdout).toBe("");
    const report = JSON.parse(outcome.stderr.trim());
    expect(report).toEqual({
      target: "uais-p1-200-student-load-lane",
      status: "BLOCKED_ENV",
      blockedReasons: [
        "dedicated-load-test-database-url-required",
        "live-mutation-confirmation-required",
        "non-production-neon-project-id-required",
        "dsn-fingerprint-nonce-required",
        "dsn-fingerprint-required",
      ],
      acceptedDatabaseEnvName: "UAIS_P1_LOAD_TEST_DATABASE_URL",
      valuesRedacted: true,
    });
    expect(outcome.stderr).not.toContain("postgres://");
    expect(outcome.stderr).not.toContain("postgresql://");
  });

  it("requires the dedicated P1 marker and origin replication role", async () => {
    expect(resolveLiveDatabaseTestInspector("p1-load")).toBe(
      inspectP1LoadDatabaseTarget,
    );
    let observedQuery = "";
    const sql = Object.assign(
      vi.fn(async (strings: TemplateStringsArray) => {
        observedQuery = strings.join("?");
        return [
          {
            environment: "isolated-p1-load-test",
            session_replication_role: "origin",
          },
        ];
      }),
      { end: vi.fn(async () => undefined) },
    );

    await expect(
      inspectP1LoadDatabaseTarget({
        databaseUrl: "postgresql://fixture:secret@fixture.invalid/load",
        createClient: () => sql,
      }),
    ).resolves.toEqual({ approved: true });
    expect(observedQuery).toContain("FROM public.uais_environment_guard");
    expect(observedQuery).toContain("isolated-p1-load-test");
    expect(observedQuery).toContain(
      "current_setting('session_replication_role')",
    );

    sql.mockResolvedValueOnce([
      {
        environment: "isolated-p1-load-test",
        session_replication_role: "replica",
      },
    ]);
    await expect(
      inspectP1LoadDatabaseTarget({
        databaseUrl: "postgresql://fixture:secret@fixture.invalid/load",
        createClient: () => sql,
      }),
    ).resolves.toEqual({ approved: false });
    expect(sql.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("rejects a P1 URL alone before opening a database connection", async () => {
    const inspectTarget = vi.fn();
    const result = await authorizeP1LoadTestTarget({
      env: {
        UAIS_P1_LOAD_TEST_DATABASE_URL:
          "postgresql://fixture:secret@fixture.invalid/load",
      },
      inspectTarget,
    });

    expect(result).toEqual({
      exitCode: 2,
      report: {
        target: "uais-p1-200-student-load-lane",
        status: "BLOCKED_ENV",
        blockedReasons: [
          "live-mutation-confirmation-required",
          "non-production-neon-project-id-required",
          "dsn-fingerprint-nonce-required",
          "dsn-fingerprint-required",
        ],
        acceptedDatabaseEnvName: "UAIS_P1_LOAD_TEST_DATABASE_URL",
        valuesRedacted: true,
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("fixture.invalid");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("authorizes the dedicated P1 identity only after its database marker is approved", async () => {
    const inspectTarget = vi.fn(async () => ({ approved: true }));
    const result = await authorizeP1LoadTestTarget({
      env: createValidP1Environment(),
      inspectTarget,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      report: {
        target: "uais-p1-200-student-load-lane",
        status: "CONFIGURED",
        selectedEnvName: "UAIS_P1_LOAD_TEST_DATABASE_URL",
        valuesRedacted: true,
      },
    });
    expect(result.databaseUrl).toBe(p1DatabaseUrl);
    expect(inspectTarget).toHaveBeenCalledWith({
      databaseUrl: p1DatabaseUrl,
    });
    expect(JSON.stringify(result.report)).not.toContain("p1-load-secret");
    expect(JSON.stringify(result.report)).not.toContain(p1NeonProjectId);
    expect(JSON.stringify(result.report)).not.toContain(p1FingerprintNonce);
  });

  it("rejects production identity and populated generic aliases before P1 inspection", async () => {
    const inspectTarget = vi.fn(async () => ({ approved: true }));
    const productionIdentity = await authorizeP1LoadTestTarget({
      env: createValidP1Environment({
        UAIS_DB_TEST_NEON_PROJECT_ID: "late-sunset-59152574",
      }),
      inspectTarget,
    });
    expect(productionIdentity).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["production-neon-project-id-rejected"],
      },
    });

    const genericAlias = await authorizeP1LoadTestTarget({
      env: createValidP1Environment({
        DATABASE_URL:
          "postgresql://generic:generic-secret@generic.invalid/uais",
      }),
      inspectTarget,
    });
    expect(genericAlias).toMatchObject({
      exitCode: 2,
      report: {
        status: "BLOCKED_ENV",
        blockedReasons: ["generic-database-url-rejected:DATABASE_URL"],
      },
    });
    expect(inspectTarget).not.toHaveBeenCalled();
    const serialized = JSON.stringify([productionIdentity, genericAlias]);
    expect(serialized).not.toContain("late-sunset-59152574");
    expect(serialized).not.toContain("generic-secret");
    expect(serialized).not.toContain("generic.invalid");
  });

  it("preflights, migrates under the same marker, and launches the exact load file with a disposable capability", async () => {
    const events: string[] = [];
    let capabilityFile = "";
    const inspectTarget = vi.fn(async () => {
      events.push("inspect");
      return { approved: true };
    });
    const childRunner = vi.fn(
      (input: {
        phase: "migration" | "test";
        command: string;
        args: string[];
        cwd: string;
        env: NodeJS.ProcessEnv;
      }) => {
        events.push(input.phase);
        expect(input.command).toBe("/node-fixture");
        expect(input.cwd).toBe("/repo-fixture");
        expect(input.env.UAIS_CORE_DATABASE_URL).toBe(p1DatabaseUrl);
        expect(input.env.UAIS_P1_LOAD_TEST_DATABASE_URL).toBe(p1DatabaseUrl);
        expect(input.env.UAIS_CORE_DATABASE_REQUIRED_GUARD).toBe(
          "isolated-p1-load-test",
        );
        expect(input.env).not.toHaveProperty("DATABASE_URL");
        expect(input.env).not.toHaveProperty("POSTGRES_URL");
        expect(input.env).not.toHaveProperty("UAIS_DB_TEST_DATABASE_URL");
        expect(input.env).not.toHaveProperty("UNRELATED_PROVIDER_SECRET");

        if (input.phase === "migration") {
          expect(input.args).toEqual(["scripts/apply-core-migrations.mjs"]);
          expect(input.env).not.toHaveProperty(
            "UAIS_LIVE_DB_TEST_CAPABILITY_FILE",
          );
          expect(input.env).not.toHaveProperty(
            "UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN",
          );
          return { status: 0, stdout: "", stderr: "" };
        }

        expect(input.args).toEqual([
          "node_modules/vitest/vitest.mjs",
          "run",
          "--environment",
          "node",
          "--no-file-parallelism",
          "--silent",
          "--reporter=json",
          "tests/learning-loop-postgres-load.integration.test.ts",
        ]);
        capabilityFile =
          input.env.UAIS_LIVE_DB_TEST_CAPABILITY_FILE ?? "";
        expect(existsSync(capabilityFile)).toBe(true);
        expect(statSync(capabilityFile).mode & 0o077).toBe(0);
        expect(input.env.UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN).toMatch(
          /^[A-Za-z0-9_-]{43}$/,
        );
        expect(input.env.UAIS_LIVE_DB_TEST_CAPABILITY_LANE).toBe("p1-load");

        const probe = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            [
              'import { authorizeLiveDatabaseTestFile } from "./scripts/run-db-tests.mjs";',
              'const result = await authorizeLiveDatabaseTestFile({ env: process.env, lane: "p1-load", testFile: "tests/learning-loop-postgres-load.integration.test.ts", inspectTarget: async () => ({ approved: true }) });',
              "process.stdout.write(JSON.stringify({ exitCode: result.exitCode, status: result.report.status }));",
              "if (result.exitCode !== 0) process.exitCode = 2;",
            ].join("\n"),
          ],
          { cwd: process.cwd(), env: input.env, encoding: "utf8" },
        );
        expect(probe.status).toBe(0);
        expect(probe.stderr).toBe("");
        expect(JSON.parse(probe.stdout)).toEqual({
          exitCode: 0,
          status: "CONFIGURED",
        });
        expect(probe.stdout).not.toContain(p1DatabaseUrl);
        expect(probe.stdout).not.toContain("p1-load-secret");
        return createPassingP1LoadResult();
      },
    );

    const runtimeTempEnvironment = Object.fromEntries(
      (["TMPDIR", "TMP", "TEMP"] as const).flatMap((name) =>
        typeof process.env[name] === "string"
          ? [[name, process.env[name]]]
          : [],
      ),
    );
    const result = await runGuardedP1LoadTest({
      env: createValidP1Environment({
        ...runtimeTempEnvironment,
        UNRELATED_PROVIDER_SECRET: "must-not-reach-load-children",
        UAIS_LIVE_DB_TEST_CAPABILITY_FILE: "/tmp/ambient-capability.json",
        UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN: "a".repeat(43),
        UAIS_LIVE_DB_TEST_CAPABILITY_LANE: "ambient",
      }),
      inspectTarget,
      childRunner,
      cwd: "/repo-fixture",
      nodeExecutable: "/node-fixture",
    });

    expect(events).toEqual(["inspect", "migration", "test"]);
    expect(result).toMatchObject({
      exitCode: 0,
      report: {
        target: "uais-p1-200-student-load-lane",
        status: "PASS",
        lane: {
          id: "p1-load",
          testFiles: ["tests/learning-loop-postgres-load.integration.test.ts"],
          expectedTests: 1,
          passedTests: 1,
          skippedTests: 0,
        },
        valuesRedacted: true,
      },
    });
    expect(childRunner).toHaveBeenCalledTimes(2);
    expect(capabilityFile).toBeTruthy();
    expect(existsSync(capabilityFile)).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(p1DatabaseUrl);
    expect(serialized).not.toContain("p1-load-secret");
    expect(serialized).not.toContain(p1NeonProjectId);
    expect(serialized).not.toContain(p1FingerprintNonce);
  }, 30_000);

  it("fails the load lane when the exact live test is skipped despite a zero child exit", async () => {
    let capabilityFile = "";
    const childRunner = vi.fn(
      (input: { phase: "migration" | "test"; env: NodeJS.ProcessEnv }) => {
        if (input.phase === "migration") {
          return { status: 0, stdout: "", stderr: "" };
        }
        capabilityFile =
          input.env.UAIS_LIVE_DB_TEST_CAPABILITY_FILE ?? "";
        const skipped = createPassingP1LoadResult();
        const body = JSON.parse(skipped.stdout);
        body.numPassedTests = 0;
        body.numPendingTests = 1;
        body.testResults[0].assertionResults[0].status = "skipped";
        return { ...skipped, stdout: JSON.stringify(body) };
      },
    );

    const result = await runGuardedP1LoadTest({
      env: createValidP1Environment(),
      inspectTarget: vi.fn(async () => ({ approved: true })),
      childRunner,
    });

    expect(result).toEqual({
      exitCode: 1,
      report: {
        target: "uais-p1-200-student-load-lane",
        status: "FAIL",
        blockedReasons: ["p1-load-live-tests-skipped"],
        selectedEnvName: "UAIS_P1_LOAD_TEST_DATABASE_URL",
        valuesRedacted: true,
      },
    });
    expect(childRunner).toHaveBeenCalledTimes(2);
    expect(capabilityFile).toBeTruthy();
    expect(existsSync(capabilityFile)).toBe(false);
  });
});

function createPassingP1LoadResult() {
  return {
    status: 0,
    stdout: JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      success: true,
      testResults: [
        {
          assertionResults: [{ status: "passed", title: "load fixture" }],
          status: "passed",
          name: `/repo-fixture/tests/learning-loop-postgres-load.integration.test.ts`,
        },
      ],
    }),
    stderr: "",
  };
}
