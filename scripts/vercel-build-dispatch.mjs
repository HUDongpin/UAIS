#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  UAIS_PRODUCTION_VERCEL_PROJECT_ID,
  UAIS_STAGING_VERCEL_PROJECT_ID,
} from "./vercel-project-identity.mjs";

const VERCEL_RUNTIME_INDICATOR_ENV_NAMES = [
  "VERCEL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_TARGET_ENV",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_REGION",
  "VERCEL_GIT_COMMIT_SHA",
];
export const UAIS_LOCAL_VERCEL_BUILD_CONFIRMATION =
  "I_CONFIRM_UAIS_VERCEL_BUILD_IS_LOCAL_ONLY";

export function runVercelBuildDispatch({
  env = process.env,
  commandRunner = runCommand,
  cwd = process.cwd(),
  nodeExecutable = process.execPath,
} = {}) {
  const projectId = readValue(env.VERCEL_PROJECT_ID);
  const vercelEnv = readValue(env.VERCEL_ENV);
  const hasVercelRuntimeIndicator = VERCEL_RUNTIME_INDICATOR_ENV_NAMES.some(
    (name) => readValue(env[name]) !== "",
  );

  if (projectId === UAIS_STAGING_VERCEL_PROJECT_ID) {
    return runSequence({
      targetClass: "isolated-staging",
      commandRunner,
      invocations: [
        {
          label: "isolated-staging-build-guard",
          command: nodeExecutable,
          args: ["scripts/vercel-staging-build-guard.mjs"],
          cwd,
          env,
        },
      ],
    });
  }

  if (projectId === UAIS_PRODUCTION_VERCEL_PROJECT_ID) {
    return runProductionBuild({ env, commandRunner, cwd, nodeExecutable });
  }

  // Keep the deliberate local operator entry useful, but any partial or real
  // Vercel identity must match an exact approved project before a child starts.
  if (!projectId && !vercelEnv && !hasVercelRuntimeIndicator) {
    if (
      readValue(env.UAIS_LOCAL_VERCEL_BUILD_CONFIRMATION) ===
      UAIS_LOCAL_VERCEL_BUILD_CONFIRMATION
    ) {
      return runProductionBuild({
        env,
        commandRunner,
        cwd,
        nodeExecutable,
        targetClass: "local",
      });
    }
    return {
      exitCode: 2,
      report: {
        target: "uais-vercel-build-dispatch",
        status: "BLOCKED_ENV",
        blockedReasons: ["explicit-local-vercel-build-confirmation-required"],
        valuesRedacted: true,
      },
    };
  }

  return {
    exitCode: 2,
    report: {
      target: "uais-vercel-build-dispatch",
      status: "BLOCKED_ENV",
      blockedReasons: ["recognized-vercel-project-id-required"],
      valuesRedacted: true,
    },
  };
}

function runProductionBuild({
  env,
  commandRunner,
  cwd,
  nodeExecutable,
  targetClass = "production",
}) {
  return runSequence({
    targetClass,
    commandRunner,
    invocations: [
      {
        label: "production-core-migrations",
        command: nodeExecutable,
        args: ["scripts/apply-core-migrations.mjs", "--deploy"],
        cwd,
        env,
      },
      {
        label: "production-next-build",
        command: nodeExecutable,
        args: ["node_modules/next/dist/bin/next", "build"],
        cwd,
        env,
      },
    ],
  });
}

function runSequence({ targetClass, commandRunner, invocations }) {
  for (const invocation of invocations) {
    const outcome = invokeCommand(commandRunner, invocation);
    if (outcome.status !== 0) {
      return {
        exitCode: 1,
        report: {
          target: "uais-vercel-build-dispatch",
          status: "FAIL",
          targetClass,
          blockedReasons: [`${invocation.label}-failed`],
          valuesRedacted: true,
        },
      };
    }
  }

  return {
    exitCode: 0,
    report: {
      target: "uais-vercel-build-dispatch",
      status: "PASS",
      targetClass,
      blockedReasons: [],
      valuesRedacted: true,
    },
  };
}

function runCommand({ command, args, cwd, env }) {
  return spawnSync(command, args, { cwd, env, stdio: "inherit" });
}

function invokeCommand(commandRunner, invocation) {
  try {
    return commandRunner(invocation) ?? { status: null };
  } catch {
    return { status: null };
  }
}

function readValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const result = runVercelBuildDispatch();
  const output = `${JSON.stringify(result.report)}\n`;
  if (result.exitCode === 0) process.stdout.write(output);
  else process.stderr.write(output);
  process.exitCode = result.exitCode;
}
