#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  encoding: "utf8",
});

if (status.trim()) {
  console.error("Release clean check failed: worktree has uncommitted or untracked files.");
  console.error(status);
  process.exit(1);
}

process.stdout.write("Release clean check passed: worktree is clean.\n");
