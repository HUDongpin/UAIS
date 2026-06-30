#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Vercel CLI auth readiness live diagnostics require explicit owner approval.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const projectLink = readProjectLink(options.projectFile);
  const envTokenStatus = hasValue(env.VERCEL_TOKEN) ? "present" : "missing";
  const vercelAuthTokenStatus =
    hasValue(env.VERCEL_AUTH_TOKEN) || hasValue(env.VERCEL_TOKEN) ? "present" : "missing";
  const cliAuthJsonStatus = readCliAuthJsonStatus(options.authFile);
  const tokenReady = envTokenStatus === "present" || vercelAuthTokenStatus === "present";
  const cliAuthCandidate = cliAuthJsonStatus === "present";
  const oidcDiscovery = tokenReady
    ? "not-required"
    : options.live
      ? await probeOidcDiscovery(options.oidcUrl)
      : "not-run";
  const cliAuthReady = cliAuthCandidate && oidcDiscovery === "reachable";
  const status = tokenReady || cliAuthReady ? "ready" : "blocked";
  const readyAuthMethod = tokenReady ? "env-token" : cliAuthReady ? "cli-auth-json" : "missing";

  process.stdout.write(
    `${JSON.stringify(
      {
        target: "vercel-cli-auth-readiness",
        mode: options.live ? "live" : "dry-run",
        status,
        responsibleSession: "S22",
        readyAuthMethod,
        projectLink,
        authMethods: {
          envToken: envTokenStatus,
          vercelAuthToken: vercelAuthTokenStatus,
          cliAuthJson: cliAuthJsonStatus,
          oidcDiscovery,
          valuesRedacted: true,
        },
        blockedReasons: readBlockedReasons({
          tokenReady,
          cliAuthCandidate,
          oidcDiscovery,
        }),
        safety: {
          valuesRedacted: true,
          tokenValuesOmitted: true,
          authFilePathOmitted: true,
          envFilePathOmitted: true,
          projectIdsOmitted: true,
          orgIdsOmitted: true,
          liveRequiresApproval: true,
          productionMutationPerformed: false,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Vercel CLI auth readiness failed."}\n`,
  );
  process.exitCode = 1;
}

function readBlockedReasons({ tokenReady, cliAuthCandidate, oidcDiscovery }) {
  if (tokenReady || (cliAuthCandidate && oidcDiscovery === "reachable")) {
    return [];
  }

  return [
    ...(cliAuthCandidate ? [] : ["vercel-token-missing", "vercel-cli-auth-json-missing"]),
    ...(oidcDiscovery === "reachable" ? [] : ["vercel-oidc-discovery-not-proven"]),
  ];
}

function readProjectLink(projectFile) {
  if (!projectFile || !existsSync(projectFile)) {
    return {
      status: "missing",
      projectName: "missing",
      projectId: "missing",
      orgId: "missing",
      valuesRedacted: true,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(projectFile, "utf8"));
    return {
      status: "linked",
      projectName: typeof parsed.projectName === "string" ? parsed.projectName : "present",
      projectId: hasValue(parsed.projectId) ? "present" : "missing",
      orgId: hasValue(parsed.orgId) ? "present" : "missing",
      valuesRedacted: true,
    };
  } catch {
    return {
      status: "unreadable",
      projectName: "missing",
      projectId: "missing",
      orgId: "missing",
      valuesRedacted: true,
    };
  }
}

function readCliAuthJsonStatus(authFile) {
  const candidateFiles = authFile
    ? [authFile]
    : [
        join(homedir(), ".vercel", "auth.json"),
        join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json"),
      ];

  for (const candidateFile of candidateFiles) {
    if (!existsSync(candidateFile)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(candidateFile, "utf8"));
      if (hasValue(parsed.token) || hasValue(parsed.authToken)) {
        return "present";
      }
      return "present-without-token";
    } catch {
      return "unreadable";
    }
  }

  return "missing";
}

async function probeOidcDiscovery(oidcUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(oidcUrl, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return "failed";
    }
    const body = await response.json().catch(() => undefined);
    return body && typeof body === "object" ? "reachable" : "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timeout);
  }
}

function readEnvFile(envFile) {
  if (!envFile || !existsSync(envFile)) {
    return {};
  }

  const env = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    env[match[1]] = unwrapEnvValue(match[2]);
  }
  return env;
}

function unwrapEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    envFile: undefined,
    projectFile: ".vercel/project.json",
    authFile: undefined,
    oidcUrl: "https://vercel.com/.well-known/openid-configuration",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--project-file") {
      options.projectFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--auth-file") {
      options.authFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--oidc-url") {
      options.oidcUrl = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/vercel-cli-auth-readiness.mjs [--dry-run|--live --approved] [--env-file PATH] [--project-file PATH] [--auth-file PATH] [--oidc-url URL]",
          "",
          "Reports redacted Vercel CLI auth readiness. Token and auth-file values are never printed.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
    }
  }

  return options;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
