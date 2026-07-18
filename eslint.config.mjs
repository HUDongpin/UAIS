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
  // ~3.7k (was 4.1k) — S12 (parked surface). error/guards/paths modules extracted;
  // remaining normalizer/IO clusters are deeply interleaved (follow-up).
  "src/lib/server/external-storage-route-service.ts",
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
