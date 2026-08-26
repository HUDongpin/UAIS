import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeP1LoadTestTarget,
  createDbTestDsnFingerprint,
  inspectP1LoadDatabaseTarget,
  LIVE_MUTATION_CONFIRMATION,
  resolveLiveDatabaseTestInspector,
} from "../scripts/run-db-tests.mjs";
import * as p1LoadRunner from "../scripts/run-p1-load-test.mjs";
import { runGuardedP1LoadTest } from "../scripts/run-p1-load-test.mjs";

const p1DatabaseUrl =
  "postgresql://p1-load-user:p1-load-secret@p1-load.example.test/uais_load";
const p1NeonProjectId = "isolated-p1-load-project";
const p1FingerprintNonce =
  "p1-load-fixture-nonce-with-at-least-thirty-two-characters";
const expectedDiagnosticPhaseSchemas = [
  { id: "task-read", operationCount: 200, concurrency: 50 },
  { id: "checkpoint", operationCount: 200, concurrency: 40 },
  { id: "autosave", operationCount: 600, concurrency: 40 },
  { id: "submit", operationCount: 200, concurrency: 50 },
  { id: "teacher-decision", operationCount: 20, concurrency: 20 },
] as const;

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
  it("aggregates only bounded allowlisted Postgres observation samples", () => {
    expect(p1LoadRunner.createP1LoadPhaseObserver).toBeTypeOf("function");

    const observer = p1LoadRunner.createP1LoadPhaseObserver({ poolMax: 2 });
    observer.record({
      activeOperationCount: 5,
      sessions: [
        {
          state: "active",
          waitEventType: "Lock",
          transactionAgeMs: 20.129,
          queryAgeMs: 10.456,
          queryText: "select private_value from private_table",
          databaseUrl: p1DatabaseUrl,
        },
        {
          state: "active",
          waitEventType: null,
          transactionAgeMs: 40,
          queryAgeMs: 30,
        },
        {
          state: "idle",
          waitEventType: "Client",
          transactionAgeMs: null,
          queryAgeMs: null,
        },
      ],
    });
    observer.record({ activeOperationCount: 0, sessions: [] });
    observer.recordError();

    const result = observer.snapshot();
    expect(result).toEqual({
      sampleCount: 2,
      observerErrorCount: 1,
      connectionPeak: 3,
      busyPeak: 2,
      estimatedQueuePeak: 3,
      queuePresenceSamples: 1,
      saturationSamples: 1,
      transactionAgesMs: [20.13, 40],
      queryAgesMs: [10.46, 30],
      waitSampleCounts: {
        lock: 1,
        io: 0,
        lwlock: 0,
        client: 0,
        ipc: 0,
        timeout: 0,
        activity: 0,
        extension: 0,
        bufferPin: 0,
        none: 1,
        other: 0,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private_table");
    expect(serialized).not.toContain("postgresql://");
  });

  it("reports bounded pg_stat_statements deltas or explicit unavailability", () => {
    expect(p1LoadRunner.diffP1LoadQueryStats).toBeTypeOf("function");

    expect(
      p1LoadRunner.diffP1LoadQueryStats(
        { available: true, calls: 100, totalExecMs: 500 },
        { available: true, calls: 125, totalExecMs: 612.345 },
      ),
    ).toEqual({ available: true, calls: 25, totalExecMs: 112.35 });
    expect(
      p1LoadRunner.diffP1LoadQueryStats(
        { available: true, calls: 100, totalExecMs: 500 },
        { available: true, calls: 90, totalExecMs: 450 },
      ),
    ).toEqual({ available: false, calls: 0, totalExecMs: 0 });
    expect(
      p1LoadRunner.diffP1LoadQueryStats(
        { available: false, calls: 0, totalExecMs: 0 },
        { available: false, calls: 0, totalExecMs: 0 },
      ),
    ).toEqual({ available: false, calls: 0, totalExecMs: 0 });
  });

  it("wires the live P1 lane to five observed phases before unchanged gates", () => {
    const source = readFileSync(
      "tests/learning-loop-postgres-load.integration.test.ts",
      "utf8",
    );

    for (const phaseId of [
      "task-read",
      "checkpoint",
      "autosave",
      "submit",
      "teacher-decision",
    ]) {
      expect(source).toContain(`id: "${phaseId}"`);
    }
    expect(source).toContain("createP1LoadPhaseObserver");
    expect(source).toContain("diffP1LoadQueryStats");
    expect(source).toContain("FROM pg_stat_activity");
    expect(source).toContain("FROM pg_stat_statements");
    expect(source).toContain("query NOT ILIKE '%pg_stat_activity%'");

    const receiptWriteIndex = source.lastIndexOf(
      "writeP1LoadDiagnosticReceipt({",
    );
    expect(receiptWriteIndex).toBeGreaterThan(0);
    const receiptPayloadEndIndex = source.indexOf(
      "valuesRedacted: true",
      receiptWriteIndex,
    );
    expect(receiptPayloadEndIndex).toBeGreaterThan(receiptWriteIndex);
    const receiptPayloadSource = source.slice(
      receiptWriteIndex,
      receiptPayloadEndIndex,
    );
    expect(receiptPayloadSource).toContain("autosaveWindowMs,");
    expect(receiptPayloadSource).toContain("submitWindowMs,");
    for (const unchangedGate of [
      "expect(autosaveWindowMs).toBeGreaterThanOrEqual(AUTOSAVE_WINDOW_MS)",
      "expect(submitWindowMs).toBeLessThanOrEqual(SUBMIT_WINDOW_MS)",
      "expect(evidence[0]).toMatchObject({",
      "expect(duplicateVersions).toHaveLength(0)",
      "expect(percentile95(checkpointDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS)",
      "expect(percentile95(autosaveDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS)",
      "expect(percentile95(submitDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS)",
      "expect(percentile95(decisionDurations)).toBeLessThanOrEqual(CORE_WRITE_P95_MS)",
    ]) {
      const gateIndex = source.indexOf(unchangedGate);
      expect(gateIndex, unchangedGate).toBeGreaterThan(receiptWriteIndex);
    }
  });

  it("summarizes only bounded phase, pool, transaction, query, and wait timing", () => {
    expect(p1LoadRunner.buildP1LoadPhaseDiagnostics).toBeTypeOf("function");

    const result = p1LoadRunner.buildP1LoadPhaseDiagnostics({
      id: "submit",
      operationDurations: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      operationCount: 10,
      concurrency: 5,
      sampleIntervalMs: 50,
      observation: {
        sampleCount: 2,
        observerErrorCount: 0,
        connectionPeak: 5,
        busyPeak: 4,
        estimatedQueuePeak: 2,
        queuePresenceSamples: 3,
        saturationSamples: 2,
        transactionAgesMs: [10, 20, 30, 40],
        queryAgesMs: [5, 15, 25],
        waitSampleCounts: {
          lock: 1,
          io: 2,
          lwlock: 3,
          client: 4,
          ipc: 5,
          timeout: 6,
          activity: 7,
          extension: 8,
          bufferPin: 9,
          none: 10,
          other: 11,
        },
      },
      queryStats: {
        available: true,
        calls: 25,
        totalExecMs: 100,
      },
    });

    expect(result).toEqual({
      id: "submit",
      operationCount: 10,
      concurrency: 5,
      operationMs: { p50: 50, p95: 100, max: 100 },
      operationSamplesMs: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      pool: {
        sampleCount: 2,
        observerErrorCount: 0,
        connectionPeak: 5,
        busyPeak: 4,
        estimatedQueuePeak: 2,
        queuePresenceMs: 150,
        saturationMs: 100,
      },
      transaction: {
        sampleCount: 4,
        ageP50Ms: 20,
        ageP95Ms: 40,
        ageMaxMs: 40,
      },
      query: {
        statsAvailable: true,
        calls: 25,
        totalExecMs: 100,
        meanExecMs: 4,
        ageP95Ms: 25,
        ageMaxMs: 25,
      },
      waitSampleMs: {
        lock: 50,
        io: 100,
        lwlock: 150,
        client: 200,
        ipc: 250,
        timeout: 300,
        activity: 350,
        extension: 400,
        bufferPin: 450,
        none: 500,
        other: 550,
      },
    });
    expect(JSON.stringify(result)).not.toContain("queryText");
    expect(JSON.stringify(result)).not.toContain("databaseUrl");
  });

  it("writes only a mode-0600 allowlisted diagnostic receipt", () => {
    expect(p1LoadRunner.writeP1LoadDiagnosticReceipt).toBeTypeOf("function");
    const directory = mkdtempSync(join(tmpdir(), "uais-p1-diagnostic-writer-test-"));
    const file = join(directory, "receipt.json");
    try {
      p1LoadRunner.writeP1LoadDiagnosticReceipt({
        file,
        receipt: {
          ...createDiagnosticReceiptFixture(),
          databaseUrl: p1DatabaseUrl,
          queryText: "select secret from private_table",
          secret: "writer-secret-must-not-survive",
        },
      });

      expect(statSync(file).mode & 0o077).toBe(0);
      const body = JSON.parse(readFileSync(file, "utf8"));
      expect(body).toMatchObject({
        version: 1,
        target: "uais-p1-200-student-load-diagnostic",
        mode: "diagnostic-only",
        studentCount: 200,
        valuesRedacted: true,
      });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("postgresql://");
      expect(serialized).not.toContain("private_table");
      expect(serialized).not.toContain("writer-secret-must-not-survive");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists both windows and independently recomputable phase p95 evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "uais-p1-diagnostic-evidence-test-"));
    const file = join(directory, "receipt.json");
    try {
      p1LoadRunner.writeP1LoadDiagnosticReceipt({
        file,
        receipt: createDiagnosticReceiptFixture(),
      });

      const body = JSON.parse(readFileSync(file, "utf8"));
      expect(body.autosaveWindowMs).toBe(300_000);
      expect(body.submitWindowMs).toBe(29_900);
      for (const phase of body.phases) {
        expect(phase.operationSamplesMs).toHaveLength(phase.operationCount);
        expect(percentile95FromSamples(phase.operationSamplesMs)).toBe(
          phase.operationMs.p95,
        );
      }

      // This mode-0600 file is the unsigned nested diagnostic v1 payload.
      // HMAC authentication belongs to the separate external receipt v4 envelope.
      expect(body.version).toBe(1);
      expect(body).not.toHaveProperty("hmac");
      expect(body).not.toHaveProperty("signature");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects noncanonical lane and five-phase execution shapes", () => {
    const invalidReceipts = [
      {
        label: "pool maximum",
        receipt: { ...createDiagnosticReceiptFixture(), poolMax: 41 },
      },
      {
        label: "sample interval",
        receipt: { ...createDiagnosticReceiptFixture(), sampleIntervalMs: 99 },
      },
      ...expectedDiagnosticPhaseSchemas.flatMap((schema, phaseIndex) =>
        (["operationCount", "concurrency"] as const).map((field) => {
          const receipt = createDiagnosticReceiptFixture();
          receipt.phases[phaseIndex] = {
            ...receipt.phases[phaseIndex]!,
            [field]: schema[field] + 1,
          };
          return {
            label: `${schema.id} ${field}`,
            receipt,
          };
        }),
      ),
    ];

    for (const { label, receipt } of invalidReceipts) {
      expect(
        () => writeDiagnosticReceiptFixture(receipt),
        label,
      ).toThrow("P1 diagnostic receipt is invalid");
    }
  });

  it("retains failed gate values when the canonical execution shape is intact", () => {
    const receipt = createDiagnosticReceiptFixture();
    receipt.autosaveWindowMs = 299_000;
    receipt.submitWindowMs = 30_820;
    receipt.counts.attempts = 199;
    receipt.phases[1] = createDiagnosticPhaseFixture(
      "checkpoint",
      200,
      40,
      6_589.14,
    );

    const body = writeDiagnosticReceiptFixture(receipt);
    expect(body).toMatchObject({
      autosaveWindowMs: 299_000,
      submitWindowMs: 30_820,
      counts: { attempts: 199 },
      phases: expect.arrayContaining([
        expect.objectContaining({
          id: "checkpoint",
          operationMs: expect.objectContaining({ p95: 6_589.14 }),
        }),
      ]),
    });
  });

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
    let diagnosticFile = "";
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
        diagnosticFile = input.env.UAIS_P1_LOAD_DIAGNOSTIC_FILE ?? "";
        expect(diagnosticFile).toBeTruthy();
        expect(existsSync(diagnosticFile)).toBe(false);

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
        writeDiagnosticReceipt(diagnosticFile);
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
    expect(diagnosticFile).toBeTruthy();
    expect(existsSync(diagnosticFile)).toBe(false);
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

  it("returns bounded redacted diagnostics when the P1 test process fails", async () => {
    let diagnosticFile = "";
    const childRunner = vi.fn(
      (input: { phase: "migration" | "test"; env: NodeJS.ProcessEnv }) => {
        if (input.phase === "migration") {
          return { status: 0, signal: null, stdout: "", stderr: "" };
        }

        diagnosticFile = input.env.UAIS_P1_LOAD_DIAGNOSTIC_FILE ?? "";
        if (diagnosticFile) {
          writeFileSync(
            diagnosticFile,
            JSON.stringify({
              version: 1,
              target: "uais-p1-200-student-load-diagnostic",
              mode: "diagnostic-only",
              studentCount: 200,
              poolMax: 40,
              sampleIntervalMs: 100,
              autosaveWindowMs: 300_100,
              submitWindowMs: 30_820,
              counts: {
                attempts: 200,
                submissions: 200,
                versions: 200,
                accepted: 20,
                awaiting: 180,
                events: 440,
                outboxRows: 440,
                profiles: 200,
              },
              duplicateVersionCount: 0,
              phases: [
                createDiagnosticPhaseFixture("task-read", 200, 50, 4_735.7),
                createDiagnosticPhaseFixture("checkpoint", 200, 40, 6_589.14),
                createDiagnosticPhaseFixture("autosave", 600, 40, 4_665),
                createDiagnosticPhaseFixture("submit", 200, 50, 10_753.24),
                createDiagnosticPhaseFixture("teacher-decision", 20, 20, 7_951.5),
              ],
              databaseUrl: p1DatabaseUrl,
              queryText: "select private_value from private_table",
              secret: "diagnostic-secret-must-not-survive",
              valuesRedacted: true,
            }),
            { encoding: "utf8", flag: "wx", mode: 0o600 },
          );
        }

        return {
          status: 1,
          signal: null,
          stdout: JSON.stringify({
            numTotalTests: 1,
            numPassedTests: 0,
            numFailedTests: 1,
            numPendingTests: 0,
            numTodoTests: 0,
            success: false,
            testResults: [
              {
                assertionResults: [{ status: "failed", title: "load fixture" }],
                status: "failed",
                name: `/repo-fixture/tests/learning-loop-postgres-load.integration.test.ts`,
              },
            ],
          }),
          stderr: `postgresql://private:secret@private.invalid/load\n${p1DatabaseUrl}\ndiagnostic-secret-must-not-survive`,
        };
      },
    );

    const result = await runGuardedP1LoadTest({
      env: createValidP1Environment(),
      inspectTarget: vi.fn(async () => ({ approved: true })),
      childRunner,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      report: {
        target: "uais-p1-200-student-load-lane",
        status: "FAIL",
        blockedReasons: ["p1-load-test-process-failed"],
        process: {
          status: 1,
          signal: null,
          timedOut: false,
          vitest: {
            totalTests: 1,
            passedTests: 0,
            failedTests: 1,
            pendingTests: 0,
            failedFileCount: 1,
          },
        },
        diagnostics: {
          status: "CAPTURED",
          version: 1,
          target: "uais-p1-200-student-load-diagnostic",
          mode: "diagnostic-only",
          studentCount: 200,
          poolMax: 40,
          sampleIntervalMs: 100,
          autosaveWindowMs: 300_100,
          submitWindowMs: 30_820,
          counts: {
            attempts: 200,
            submissions: 200,
            versions: 200,
            accepted: 20,
            awaiting: 180,
            events: 440,
            outboxRows: 440,
            profiles: 200,
          },
          duplicateVersionCount: 0,
          phases: expect.arrayContaining([
            expect.objectContaining({
              id: "submit",
              operationCount: 200,
              concurrency: 50,
              operationMs: { p50: 5_000, p95: 10_753.24, max: 12_000 },
              query: {
                statsAvailable: true,
                calls: 2_600,
                totalExecMs: 24_000,
                meanExecMs: 9.23,
                ageP95Ms: 410,
                ageMaxMs: 600,
              },
            }),
          ]),
          valuesRedacted: true,
        },
        valuesRedacted: true,
      },
    });
    expect(childRunner).toHaveBeenCalledTimes(2);
    expect(diagnosticFile).toBeTruthy();
    expect(existsSync(diagnosticFile)).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("private.invalid");
    expect(serialized).not.toContain("private_table");
    expect(serialized).not.toContain("diagnostic-secret-must-not-survive");
    expect(serialized).not.toContain(p1NeonProjectId);
    expect(serialized).not.toContain(p1FingerprintNonce);
  });

  it("fails closed when a passing P1 process omits its diagnostic receipt", async () => {
    const childRunner = vi.fn(
      (input: { phase: "migration" | "test" }) =>
        input.phase === "migration"
          ? { status: 0, signal: null, stdout: "", stderr: "" }
          : createPassingP1LoadResult(),
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
        blockedReasons: ["p1-load-diagnostic-receipt-missing"],
        selectedEnvName: "UAIS_P1_LOAD_TEST_DATABASE_URL",
        diagnostics: {
          status: "MISSING",
          valuesRedacted: true,
        },
        valuesRedacted: true,
      },
    });
  });
});

function createDiagnosticPhaseFixture(
  id: string,
  operationCount: number,
  concurrency: number,
  p95: number,
) {
  const operationSamplesMs = createOperationSamples(operationCount, p95);
  return {
    id,
    operationCount,
    concurrency,
    operationMs: summarizeOperationSamples(operationSamplesMs),
    operationSamplesMs,
    pool: {
      sampleCount: 40,
      observerErrorCount: 0,
      connectionPeak: 40,
      busyPeak: 40,
      estimatedQueuePeak: 10,
      queuePresenceMs: 500,
      saturationMs: 450,
    },
    transaction: {
      sampleCount: 40,
      ageP50Ms: 120,
      ageP95Ms: 700,
      ageMaxMs: 900,
    },
    query: {
      statsAvailable: true,
      calls: 2_600,
      totalExecMs: 24_000,
      meanExecMs: 9.23,
      ageP95Ms: 410,
      ageMaxMs: 600,
    },
    waitSampleMs: {
      lock: 0,
      io: 50,
      lwlock: 25,
      client: 100,
      ipc: 0,
      timeout: 0,
      activity: 0,
      extension: 0,
      bufferPin: 0,
      none: 400,
      other: 0,
    },
  };
}

function writeDiagnosticReceipt(file: string) {
  writeFileSync(
    file,
    JSON.stringify(createDiagnosticReceiptFixture()),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

function createDiagnosticReceiptFixture() {
  return {
    version: 1,
    target: "uais-p1-200-student-load-diagnostic",
    mode: "diagnostic-only",
    studentCount: 200,
    poolMax: 40,
    sampleIntervalMs: 100,
    autosaveWindowMs: 300_000,
    submitWindowMs: 29_900,
    counts: {
      attempts: 200,
      submissions: 200,
      versions: 200,
      accepted: 20,
      awaiting: 180,
      events: 440,
      outboxRows: 440,
      profiles: 200,
    },
    duplicateVersionCount: 0,
    phases: [
      createDiagnosticPhaseFixture("task-read", 200, 50, 900),
      createDiagnosticPhaseFixture("checkpoint", 200, 40, 900),
      createDiagnosticPhaseFixture("autosave", 600, 40, 900),
      createDiagnosticPhaseFixture("submit", 200, 50, 900),
      createDiagnosticPhaseFixture("teacher-decision", 20, 20, 900),
    ],
    valuesRedacted: true,
  };
}

function createOperationSamples(operationCount: number, p95: number) {
  const p50 = Math.round(Math.min(5_000, p95 / 2) * 100) / 100;
  const max = Math.round(Math.max(12_000, p95) * 100) / 100;
  const p50Index = Math.max(0, Math.ceil(operationCount * 0.5) - 1);
  const p95Index = Math.max(0, Math.ceil(operationCount * 0.95) - 1);
  return Array.from({ length: operationCount }, (_, index) => {
    if (index <= p50Index) return p50;
    if (index <= p95Index) return p95;
    return max;
  });
}

function summarizeOperationSamples(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (value: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0;
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
  };
}

function percentile95FromSamples(samples: number[]) {
  return summarizeOperationSamples(samples).p95;
}

function writeDiagnosticReceiptFixture(receipt: ReturnType<typeof createDiagnosticReceiptFixture>) {
  const directory = mkdtempSync(join(tmpdir(), "uais-p1-diagnostic-shape-test-"));
  const file = join(directory, "receipt.json");
  try {
    p1LoadRunner.writeP1LoadDiagnosticReceipt({ file, receipt });
    return JSON.parse(readFileSync(file, "utf8"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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
