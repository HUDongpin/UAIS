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
});
