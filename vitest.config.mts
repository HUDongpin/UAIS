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
    // Mirrors the `.claude/**` ignore in `eslint.config.mjs`. Agent worktrees
    // under `.claude/` carry a full copy of `tests/`, so without this a root run
    // executes every suite once per worktree - and those copies resolve
    // `process.cwd()` fixtures against the root checkout while importing their
    // own stale `src/`, which reports failures that belong to neither tree.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
