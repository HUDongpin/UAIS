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
  "src/components/pages/teaching-page.tsx", // 7.7k — S05 decomposition target
  "src/lib/server/teaching-course-management-store.ts", // 6.7k — S12
  "src/lib/server/teaching-operations-store.ts", // 4.9k — S12
  "src/lib/server/external-storage-route-service.ts", // 4.1k — S12 (parked surface)
  "src/app/api/teaching/operations/route.ts", // 4.1k — S05/S12
  "src/components/pages/learning-page.tsx", // 3.6k — S03/S04
  "src/components/teaching/teaching-operation-page.tsx", // 2.6k — S05
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
