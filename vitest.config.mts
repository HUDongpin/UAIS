import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15000,
    // Many acceptance suites spawn child processes and local fixture servers.
    // Running files concurrently can starve those bounded probes and turn
    // otherwise passing offline contracts into false 15-second timeouts.
    fileParallelism: false,
    // Mirrors the local-worktree ignores in `eslint.config.mjs`. Agent
    // worktrees carry a full copy of `tests/`, so without these a root run
    // executes every suite once per worktree - and those copies resolve
    // `process.cwd()` fixtures against the root checkout while importing their
    // own stale `src/`, which reports failures that belong to neither tree.
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/.playwright-cli/**",
      "**/.scratch/**",
      "**/.worktrees/**",
      "**/coverage/**",
      "**/output/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/worktrees/**",
      // Playwright owns this suite. Importing these files into Vitest calls
      // test.describe/test.use outside the Playwright runner and makes the
      // otherwise offline default lane fail before any browser test runs.
      "tests/p2/browser/**",
    ],
  },
});
