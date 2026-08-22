import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Phase 3 decomposition guardrail: cap new source files so the "worst files"
// problem cannot regrow while the legacy giants are split down. `max` counts
// code lines only (blanks/comments skipped). The exemption list below is the
// explicit decomposition-debt register — remove a file from it once it is
// split below the cap; do not add new files to it.
const maxSourceFileLines = 1500;
// The decomposition-debt register is now empty: all four original giants (teaching-page,
// learning-page, teaching-operation-page, external-storage-route-service) are decomposed
// below the cap, so the max-lines rule below enforces every source file with no
// exemptions. If a file grows past the cap, split it — do not re-add an exemption list.

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "max-lines": [
        "error",
        { max: maxSourceFileLines, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent tooling (git-ignored via .gitignore): agent worktrees carry
    // full source/test copies and build output, which must never reach lint.
    ".claude/**",
    ".worktrees/**",
    ".tmp/**",
    "worktrees/**",
    // Generated Next.js output nested anywhere (e.g. inside a stray worktree).
    "**/.next/**",
  ]),
]);

export default eslintConfig;
