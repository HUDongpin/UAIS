import { ESLint } from "eslint";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import eslintConfig from "../eslint.config.mjs";
import vitestConfig from "../vitest.config.mts";

function collectEslintIgnorePatterns(config: unknown): string[] {
  if (!Array.isArray(config)) {
    return [];
  }

  return config.flatMap((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("ignores" in entry) ||
      !Array.isArray(entry.ignores)
    ) {
      return [];
    }

    return entry.ignores.filter(
      (pattern): pattern is string => typeof pattern === "string",
    );
  });
}

describe("root quality-gate worktree isolation", () => {
  it("keeps Git-ignored local worktree roots out of ESLint discovery", () => {
    const ignorePatterns = collectEslintIgnorePatterns(eslintConfig);

    expect(ignorePatterns).toEqual(
      expect.arrayContaining([".worktrees/**", "worktrees/**"]),
    );
  });

  it("keeps local worktree test copies out of Vitest discovery", () => {
    const config = vitestConfig as {
      test?: { exclude?: string[] };
    };

    expect(config.test?.exclude).toEqual(
      expect.arrayContaining(["**/.worktrees/**", "**/worktrees/**"]),
    );
  });

  it("keeps generated and scratch artifacts out of ESLint without hiding source or tests", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });

    await expect(
      eslint.isPathIgnored(
        resolve("output/playwright/report/trace/assets/generated.js"),
      ),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(resolve("coordination/output/generated.js")),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(resolve("coverage/generated.js")),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(resolve("playwright-report/generated.js")),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(resolve("test-results/generated.js")),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(resolve("coordination/reports/.scratch/probe.ts")),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(resolve(".scratch/tooling/probe.ts")),
    ).resolves.toBe(true);
    await expect(eslint.isPathIgnored(resolve("src/app/page.tsx"))).resolves.toBe(
      false,
    );
    await expect(
      eslint.isPathIgnored(resolve("tests/tooling-worktree-isolation.test.ts")),
    ).resolves.toBe(false);
  });

  it("keeps generated and scratch test copies out of Vitest discovery", () => {
    const config = vitestConfig as {
      test?: { exclude?: string[] };
    };

    expect(config.test?.exclude).toEqual(
      expect.arrayContaining([
        "**/.scratch/**",
        "**/coverage/**",
        "**/output/**",
        "**/playwright-report/**",
        "**/test-results/**",
      ]),
    );
  });
});
