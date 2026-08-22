#!/usr/bin/env node

import { spawn } from "node:child_process";

const commands = [
  { display: "npm run lint", executable: "npm", args: ["run", "lint"], timeoutMs: 180_000 },
  { display: "npm run test", executable: "npm", args: ["run", "test"], timeoutMs: 900_000 },
  { display: "npm run test:critical", executable: "npm", args: ["run", "test:critical"], timeoutMs: 300_000 },
  { display: "npm run build", executable: "npm", args: ["run", "build"], timeoutMs: 600_000 },
  { display: "npm run test:p2:e2e", executable: "npm", args: ["run", "test:p2:e2e"], timeoutMs: 600_000 },
  { display: "npm run test:p2:a11y", executable: "npm", args: ["run", "test:p2:a11y"], timeoutMs: 600_000 },
  { display: "npm run test:p2:performance", executable: "npm", args: ["run", "test:p2:performance"], timeoutMs: 900_000 },
  {
    display: "node scripts/p2-evidence-check.mjs",
    executable: process.execPath,
    args: ["scripts/p2-evidence-check.mjs"],
    timeoutMs: 30_000,
  },
];

if (process.argv.includes("--dry-run")) {
  process.stdout.write(
    `${JSON.stringify(
      {
        target: "p2-local-quality-gate",
        status: "NOT_RUN",
        commands: commands.map((command) => command.display),
        safety: {
          shellDisabled: true,
          failFast: true,
          perCommandDeadline: true,
          externalTestsExcluded: true,
          providerLiveExcluded: true,
        },
      },
      null,
      2,
    )}\n`,
  );
} else {
  try {
    for (const command of commands) {
      process.stderr.write(`P2 gate: ${command.display}\n`);
      await runCommand(command);
    }
    process.stdout.write("P2 local quality gate PASS.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "P2 quality gate failed."}\n`);
    process.exitCode = 1;
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: false,
      detached: process.platform !== "win32",
    });
    let settled = false;
    const timer = setTimeout(() => {
      terminate(child);
      finish(new Error(`${command.display} timed out after ${command.timeoutMs}ms.`));
    }, command.timeoutMs);

    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish();
      } else {
        finish(
          new Error(
            `${command.display} failed (${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}).`,
          ),
        );
      }
    });

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }
  });
}

function terminate(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
