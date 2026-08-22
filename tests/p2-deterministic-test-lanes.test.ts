import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import vitestConfig from "../vitest.config.mts";

describe("P2 deterministic local quality gates", () => {
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
    expect(body).toEqual({
      target: "p2-deterministic-tests",
      mode: "dry-run",
      shardCount: 3,
      timeoutMsPerShard: 120000,
      commands: [
        "vitest run --no-file-parallelism --shard 1/3",
        "vitest run --no-file-parallelism --shard 2/3",
        "vitest run --no-file-parallelism --shard 3/3",
      ],
      safety: {
        shellDisabled: true,
        failFast: true,
        processTimeoutEnabled: true,
      },
    });
  });
});
