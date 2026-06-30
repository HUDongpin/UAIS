#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const reasonIndex = args.indexOf("--reason");
const outFile = outIndex >= 0 ? args[outIndex + 1] : "";
const reason = reasonIndex >= 0 ? args[reasonIndex + 1] : "";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

const porcelain = git(["status", "--porcelain=v1", "--untracked-files=all"])
  .split("\n")
  .filter(Boolean);

const entries = porcelain.map((line) => {
  const status = line.slice(0, 2);
  const path = line.slice(3);
  const topLevel = path.split("/")[0] || path;
  return { status, path, topLevel };
});

const byStatus = {};
const byTopLevel = {};

for (const entry of entries) {
  byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
  byTopLevel[entry.topLevel] = (byTopLevel[entry.topLevel] || 0) + 1;
}

const payload = {
  generatedAt: new Date().toISOString(),
  reason,
  branch: git(["branch", "--show-current"]).trim(),
  summary: {
    totalEntries: entries.length,
    byStatus,
    byTopLevel,
  },
  entries,
};

const json = `${JSON.stringify(payload, null, 2)}\n`;

if (outFile) {
  writeFileSync(outFile, json);
} else {
  process.stdout.write(json);
}
