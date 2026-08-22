#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const DEFAULT_SHARD_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 300_000;

try {
  const options = parseArgs(process.argv.slice(2));
  const commands = buildCommands(options);

  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(buildDryRunReport(options, commands), null, 2)}\n`,
    );
  } else {
    runCommands(options, commands);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Deterministic test runner failed."}\n`,
  );
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    shardCount: DEFAULT_SHARD_COUNT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    vitestArgs: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--shards") {
      options.shardCount = readIntegerArg(args, index, arg, 1, 20);
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = readIntegerArg(args, index, arg, 1_000, 3_600_000);
      index += 1;
    } else if (arg === "--") {
      options.vitestArgs.push(...args.slice(index + 1));
      break;
    } else {
      options.vitestArgs.push(arg);
    }
  }

  return options;
}

function readIntegerArg(args, index, name, minimum, maximum) {
  const raw = args[index + 1];
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isInteger(value) || String(value) !== raw || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function buildCommands(options) {
  if (options.vitestArgs.length > 0) {
    return [
      {
        label: "targeted",
        args: ["run", "--no-file-parallelism", ...options.vitestArgs],
      },
    ];
  }

  return Array.from({ length: options.shardCount }, (_, index) => ({
    label: `${index + 1}/${options.shardCount}`,
    args: [
      "run",
      "--no-file-parallelism",
      "--shard",
      `${index + 1}/${options.shardCount}`,
    ],
  }));
}

function buildDryRunReport(options, commands) {
  return {
    target: "p2-deterministic-tests",
    mode: "dry-run",
    shardCount: options.vitestArgs.length > 0 ? 1 : options.shardCount,
    timeoutMsPerShard: options.timeoutMs,
    commands: commands.map(
      (command) => `vitest ${command.args.map(quoteDisplayArg).join(" ")}`,
    ),
    safety: {
      shellDisabled: true,
      failFast: true,
      processTimeoutEnabled: true,
    },
  };
}

function quoteDisplayArg(value) {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : "<argument>";
}

function runCommands(options, commands) {
  const executable = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );

  for (const command of commands) {
    process.stderr.write(
      `P2 deterministic test shard ${command.label} started (timeout ${options.timeoutMs}ms).\n`,
    );
    const result = spawnSync(executable, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: false,
      timeout: options.timeoutMs,
      killSignal: "SIGTERM",
    });

    if (result.error) {
      const reason = result.error.code === "ETIMEDOUT" ? "timed out" : "could not start";
      throw new Error(`P2 deterministic test shard ${command.label} ${reason}.`);
    }
    if (result.status !== 0) {
      throw new Error(
        `P2 deterministic test shard ${command.label} failed with exit code ${result.status ?? "unknown"}.`,
      );
    }
  }

  process.stdout.write(
    `P2 deterministic tests passed (${commands.length} sequential shard${commands.length === 1 ? "" : "s"}).\n`,
  );
}
