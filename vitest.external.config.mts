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
    setupFiles: ["./tests/setup.ts", "./tests/p2/external-env.setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    include: [
      "tests/teaching-course-management-postgres-integration.test.ts",
      "tests/learning-chatroom-postgres-integration.test.ts",
      "tests/uais-app-account-postgres-integration.test.ts",
      "tests/teaching-course-management-cutover-integration.test.ts",
      "tests/teaching-operations-cutover-integration.test.ts",
    ],
    exclude: [
      ...configDefaults.exclude,
      "**/.claude/**",
      "**/.worktrees/**",
      "**/worktrees/**",
    ],
  },
});
