#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const reports = [
  "current-baseline.md",
  "current-journey-matrix.md",
  "current-a11y.md",
  "current-performance.md",
  "current-load.md",
  "current-operations.md",
  "current-release-gate.md",
];
const directory = "coordination/reports/p2";
const missing = [];
const invalid = [];

for (const name of reports) {
  const path = `${directory}/${name}`;
  if (!existsSync(path)) {
    missing.push(name);
    continue;
  }
  const content = readFileSync(path, "utf8");
  if (!/\b(?:PASS|FAIL|BLOCKED_ENV|NOT_RUN|INHERITED_DEBT)\b/.test(content)) {
    invalid.push(`${name}:missing-status`);
  }
  if (/(?:API_KEY|TOKEN|PASSWORD|SECRET)\s*=\s*\S+|BEGIN (?:RSA |EC )?PRIVATE KEY/i.test(content)) {
    invalid.push(`${name}:possible-secret-value`);
  }
}

const passed = missing.length === 0 && invalid.length === 0;
process.stdout.write(
  `${JSON.stringify(
    {
      target: "p2-evidence-check",
      status: passed ? "PASS" : "FAIL",
      reportCount: reports.length,
      missing,
      invalid,
      valuesRedacted: true,
    },
    null,
    2,
  )}\n`,
);
process.exitCode = passed ? 0 : 1;
