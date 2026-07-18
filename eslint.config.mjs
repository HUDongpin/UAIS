import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Phase 3 decomposition guardrail: cap new source files so the "worst files"
// problem cannot regrow while the legacy giants are split down. `max` counts
// code lines only (blanks/comments skipped). The exemption list below is the
// explicit decomposition-debt register — remove a file from it once it is
// split below the cap; do not add new files to it.
const maxSourceFileLines = 1500;
const decompositionDebtFiles = [
  // ~3.0k (was 7.3k) — S05. Leaf clusters extracted into teaching-page-{messages,
  // types,workspace-config,helpers,dialogs}.ts(x) and teacher-ppt-narration-workflow*.
  // Remaining bulk is the TeachingPage component's stateful nested handlers; next
  // step is lifting those into custom hooks.
  "src/components/pages/teaching-page.tsx",
  // ~3.7k (was 4.1k) — S12 (parked surface). error/guards/paths modules extracted;
  // remaining normalizer/IO clusters are deeply interleaved (follow-up).
  "src/lib/server/external-storage-route-service.ts",
  "src/components/pages/learning-page.tsx", // 3.4k — S03/S04
  "src/components/teaching/teaching-operation-page.tsx", // 2.5k — S05
];

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
  {
    // Grandfathered legacy giants — exempt until decomposed below the cap.
    files: decompositionDebtFiles,
    rules: {
      "max-lines": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
