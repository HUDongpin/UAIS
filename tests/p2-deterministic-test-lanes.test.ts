import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import vitestConfig from "../vitest.config.mts";
import { LIVE_DB_TEST_FILES } from "../scripts/live-db-test-contract.mjs";

const liveDatabaseTestFiles = [
  "tests/teaching-course-management-postgres-integration.test.ts",
  "tests/teacher-ai-ownership-postgres-integration.test.ts",
  "tests/learning-chatroom-postgres-integration.test.ts",
  "tests/uais-app-account-postgres-integration.test.ts",
  "tests/teaching-course-management-cutover-integration.test.ts",
  "tests/teaching-operations-cutover-integration.test.ts",
  "tests/learning-loop-postgres-integration.test.ts",
  "tests/staging-inp-rum-postgres-integration.test.ts",
  "tests/learning-loop-postgres-load.integration.test.ts",
] as const;

describe("P2 deterministic local quality gates", () => {
  it("keeps the shared inventory complete for every live-DB integration naming convention", () => {
    const discovered = readdirSync("tests")
      .filter((fileName) =>
        /(?:-postgres-integration\.test|-postgres-load\.integration\.test|-cutover-integration\.test)\.ts$/.test(
          fileName,
        ),
      )
      .map((fileName) => `tests/${fileName}`)
      .sort();

    expect([...LIVE_DB_TEST_FILES].sort()).toEqual(
      [...liveDatabaseTestFiles].sort(),
    );
    expect(discovered).toEqual([...liveDatabaseTestFiles].sort());
    for (const testFile of discovered) {
      expect(readFileSync(testFile, "utf8"), testFile).toContain(
        "authorizeLiveDatabaseTestFile",
      );
    }
  });

  it("structurally excludes the complete live-Postgres inventory from every default shard", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-deterministic-tests.mjs", "--dry-run"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { commands: string[] };
    expect(report.commands).toHaveLength(5);
    for (const command of report.commands) {
      for (const testFile of liveDatabaseTestFiles) {
        expect(command).toContain(`--exclude ${testFile}`);
      }
    }
  });

  it("serializes file execution for the default process-heavy test lane", () => {
    const config = vitestConfig as {
      test?: { fileParallelism?: boolean; exclude?: string[] };
    };

    expect(config.test?.fileParallelism).toBe(false);
    expect(config.test?.exclude).toContain("tests/p2/browser/**");
  });

  it("routes the default npm test command through the deterministic shard runner", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.test).toBe(
      "node scripts/run-deterministic-tests.mjs",
    );
  });

  it("pins the P2 browser and accessibility tools and exposes every explicit lane", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.devDependencies).toMatchObject({
      "@axe-core/playwright": "4.13.0",
      "@playwright/test": "1.62.1",
      lighthouse: "13.4.1",
    });
    expect(packageJson.scripts).toMatchObject({
      "test:p2:e2e":
        "playwright test --config=playwright.p2.config.ts --grep @e2e",
      "test:p2:a11y":
        "playwright test --config=playwright.p2.config.ts --grep @a11y",
      "test:p2:load": "node scripts/p2-load-test.mjs",
      "test:p2:performance": "node scripts/p2-performance-test.mjs",
      "test:p2:gate": "node scripts/p2-quality-gate.mjs",
      "test:external": "vitest run --config vitest.external.config.mts",
      "test:provider:live": "node scripts/p2-provider-live-smoke.mjs",
    });

    for (const path of [
      "playwright.p2.config.ts",
      "vitest.external.config.mts",
      "scripts/p2-load-test.mjs",
      "scripts/p2-performance-test.mjs",
      "scripts/p2-quality-gate.mjs",
      "scripts/p2-provider-live-smoke.mjs",
    ]) {
      expect(existsSync(path), `${path} should exist`).toBe(true);
    }
  });

  it("plans bounded sequential Vitest shards without executing them", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-deterministic-tests.mjs",
        "--dry-run",
        "--shards",
        "3",
        "--timeout-ms",
        "120000",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    if (result.status !== 0) {
      return;
    }

    const body = JSON.parse(result.stdout);
    const exclusions = liveDatabaseTestFiles
      .map((testFile) => ` --exclude ${testFile}`)
      .join("");
    expect(body).toEqual({
      target: "p2-deterministic-tests",
      mode: "dry-run",
      shardCount: 3,
      timeoutMsPerShard: 120000,
      commands: [
        `vitest run --no-file-parallelism --shard 1/3${exclusions}`,
        `vitest run --no-file-parallelism --shard 2/3${exclusions}`,
        `vitest run --no-file-parallelism --shard 3/3${exclusions}`,
      ],
      safety: {
        shellDisabled: true,
        failFast: true,
        processTimeoutEnabled: true,
      },
    });
  });

  it("excludes live database files only from default shards", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-deterministic-tests.mjs", "--dry-run"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      commands: string[];
    };
    expect(report.commands).toHaveLength(5);
    for (const testFile of liveDatabaseTestFiles) {
      expect(
        report.commands.every((command) =>
          command.includes(`--exclude ${testFile}`),
        ),
      ).toBe(true);
    }
  });

  it("fails a targeted live INP database invocation without dedicated authorization", () => {
    const env = { ...process.env };
    for (const name of [
      "UAIS_DETERMINISTIC_DB_SKIP",
      "UAIS_DB_TEST_DATABASE_URL",
      "UAIS_DB_TEST_LIVE_MUTATION_CONFIRMATION",
      "UAIS_DB_TEST_NEON_PROJECT_ID",
      "UAIS_DB_TEST_DSN_FINGERPRINT_NONCE",
      "UAIS_DB_TEST_DSN_FINGERPRINT",
      "UAIS_CORE_DATABASE_URL",
      "DATABASE_URL",
      "POSTGRES_URL",
      "UAIS_LIVE_DB_TEST_CAPABILITY_FILE",
      "UAIS_LIVE_DB_TEST_CAPABILITY_TOKEN",
      "UAIS_LIVE_DB_TEST_CAPABILITY_LANE",
    ]) {
      delete env[name];
    }

    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-deterministic-tests.mjs",
        "--",
        "tests/staging-inp-rum-postgres-integration.test.ts",
      ],
      {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("BLOCKED_ENV");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(
      "P2 deterministic tests passed",
    );
  });
});
