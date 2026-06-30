#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Vercel REST auth scope readiness live diagnostics require explicit owner approval.");
  }

  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };
  const projectLink = readProjectLink(options.projectDir);
  const tokenState = readVercelApiToken({ env, authFile: options.vercelAuthFile });
  const probes = options.live && tokenState.status === "present" && projectLink.status === "linked"
    ? await runLiveProbes({
        apiBaseUrl: options.vercelApiBaseUrl,
        token: tokenState.value,
        projectLink,
      })
    : {
        user: notRunProbe(),
        project: notRunProbe(),
        envProduction: notRunProbe(),
      };
  const blockedReasons = readBlockedReasons({ tokenState, projectLink, probes, live: options.live });
  const status = blockedReasons.length === 0 ? "ready" : "blocked";

  process.stdout.write(
    `${JSON.stringify(
      {
        target: "vercel-rest-auth-scope-readiness",
        mode: options.live ? "live" : "dry-run",
        status,
        responsibleSession: "S22",
        readyAuthMethod: tokenState.method,
        projectLink: redactProjectLink(projectLink),
        probes,
        blockedReasons,
        safety: {
          valuesRedacted: true,
          tokenValuesOmitted: true,
          authFilePathOmitted: true,
          envFilePathOmitted: true,
          projectIdsOmitted: true,
          orgIdsOmitted: true,
          accountNamesOmitted: true,
          responseBodiesOmitted: true,
          liveRequiresApproval: true,
          noMutation: true,
        },
      },
      null,
      2,
    )}\n`,
  );
  if (status !== "ready") {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Vercel REST auth scope readiness failed."}\n`,
  );
  process.exitCode = 1;
}

async function runLiveProbes({ apiBaseUrl, token, projectLink }) {
  const user = await probeEndpoint({
    apiBaseUrl,
    token,
    path: "/v2/user",
  });
  const project = await probeEndpoint({
    apiBaseUrl,
    token,
    path: `/v9/projects/${encodeURIComponent(projectLink.projectId)}`,
    searchParams: readTeamSearchParams(projectLink),
  });
  const envProduction = await probeEndpoint({
    apiBaseUrl,
    token,
    path: `/v10/projects/${encodeURIComponent(projectLink.projectId)}/env`,
    searchParams: {
      target: "production",
      source: "vercel-cli:env:ls",
      ...readTeamSearchParams(projectLink),
    },
  });

  return {
    user,
    project,
    envProduction,
  };
}

async function probeEndpoint({ apiBaseUrl, token, path, searchParams = {} }) {
  const url = new URL(path, apiBaseUrl);
  for (const [key, value] of Object.entries(searchParams)) {
    if (hasValue(value)) {
      url.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });
    return {
      status: response.ok ? "passed" : "failed",
      httpStatus: response.status,
      failureClass: response.ok ? "none" : classifyHttpFailure(response.status),
      responseBodyOmitted: true,
    };
  } catch {
    return {
      status: "failed",
      httpStatus: "network-error",
      failureClass: "network-error",
      responseBodyOmitted: true,
    };
  }
}

function readBlockedReasons({ tokenState, projectLink, probes, live }) {
  if (!live) {
    return ["vercel-rest-auth-scope-live-not-run"];
  }
  if (tokenState.status !== "present") {
    return ["vercel-rest-token-missing"];
  }
  if (projectLink.status !== "linked") {
    return ["vercel-project-link-missing"];
  }

  const reasons = [];
  if (probes.user.failureClass === "auth-required") {
    reasons.push("vercel-rest-user-auth-required");
  } else if (probes.user.status !== "passed") {
    reasons.push("vercel-rest-user-probe-not-passed");
  }

  if (probes.project.failureClass === "auth-required") {
    reasons.push("vercel-rest-project-auth-required");
  } else if (probes.project.failureClass === "project-not-linked") {
    reasons.push("vercel-rest-project-not-found");
  } else if (probes.project.status !== "passed") {
    reasons.push("vercel-rest-project-probe-not-passed");
  }

  if (probes.envProduction.failureClass === "auth-required") {
    reasons.push("vercel-rest-env-auth-required");
  } else if (probes.envProduction.failureClass === "project-not-linked") {
    reasons.push("vercel-rest-env-project-not-found");
  } else if (probes.envProduction.status !== "passed") {
    reasons.push("vercel-rest-env-probe-not-passed");
  }

  return [...new Set(reasons)];
}

function classifyHttpFailure(status) {
  if (status === 401 || status === 403) {
    return "auth-required";
  }
  if (status === 404) {
    return "project-not-linked";
  }
  if (status >= 500) {
    return "network-error";
  }
  return "unknown";
}

function readTeamSearchParams(projectLink) {
  return projectLink.orgId?.startsWith("team_")
    ? { teamId: projectLink.orgId }
    : {};
}

function notRunProbe() {
  return {
    status: "not-run",
    httpStatus: "not-run",
    failureClass: "not-run",
    responseBodyOmitted: true,
  };
}

function readProjectLink(projectDir) {
  const resolvedProjectDir = resolve(projectDir ?? ".");
  const projectJsonPath = join(resolvedProjectDir, ".vercel", "project.json");
  if (existsSync(projectJsonPath)) {
    try {
      const parsed = readJsonFile(projectJsonPath);
      if (hasValue(parsed?.projectId) && hasValue(parsed?.orgId)) {
        return {
          status: "linked",
          projectId: parsed.projectId.trim(),
          orgId: parsed.orgId.trim(),
          orgScope: parsed.orgId.trim().startsWith("team_") ? "team" : "personal",
          projectName: hasValue(parsed?.projectName) ? "present" : "missing",
        };
      }
    } catch {
      return {
        status: "unreadable",
        orgScope: "missing",
      };
    }
  }

  return {
    status: "missing",
    orgScope: "missing",
  };
}

function redactProjectLink(projectLink) {
  return {
    status: projectLink.status,
    projectId: hasValue(projectLink.projectId) ? "present" : "missing",
    orgId: hasValue(projectLink.orgId) ? "present" : "missing",
    orgScope: projectLink.orgScope ?? "missing",
    projectName: projectLink.projectName ?? "missing",
    valuesRedacted: true,
  };
}

function readVercelApiToken({ env, authFile }) {
  if (hasValue(env.VERCEL_TOKEN)) {
    return {
      status: "present",
      method: "env-token",
      value: env.VERCEL_TOKEN.trim(),
    };
  }
  if (hasValue(env.VERCEL_AUTH_TOKEN)) {
    return {
      status: "present",
      method: "env-token",
      value: env.VERCEL_AUTH_TOKEN.trim(),
    };
  }

  const candidateFiles = authFile ? [authFile] : readVercelAuthFileCandidates();
  for (const candidateFile of candidateFiles) {
    if (!existsSync(candidateFile)) {
      continue;
    }
    try {
      const parsed = readJsonFile(candidateFile);
      if (hasValue(parsed?.token)) {
        return {
          status: "present",
          method: "cli-auth-json",
          value: parsed.token.trim(),
        };
      }
      if (hasValue(parsed?.authToken)) {
        return {
          status: "present",
          method: "cli-auth-json",
          value: parsed.authToken.trim(),
        };
      }
      return {
        status: "missing",
        method: "cli-auth-json-without-token",
        value: undefined,
      };
    } catch {
      return {
        status: "missing",
        method: "cli-auth-json-unreadable",
        value: undefined,
      };
    }
  }

  return {
    status: "missing",
    method: "missing",
    value: undefined,
  };
}

function readVercelAuthFileCandidates() {
  const home = homedir();
  return [
    join(home, ".vercel", "auth.json"),
    join(home, ".config", "vercel", "auth.json"),
    join(home, "Library", "Application Support", "com.vercel.cli", "auth.json"),
  ];
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

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    projectDir: ".",
    envFile: undefined,
    vercelAuthFile: undefined,
    vercelApiBaseUrl: "https://api.vercel.com",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--project-dir") {
      options.projectDir = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--env-file") {
      options.envFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-auth-file") {
      options.vercelAuthFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--vercel-api-base-url") {
      options.vercelApiBaseUrl = normalizeVercelApiBaseUrl(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/vercel-rest-auth-scope-readiness.mjs [--dry-run|--live --approved] [--project-dir PATH] [--env-file PATH] [--vercel-auth-file PATH] [--vercel-api-base-url URL]",
          "",
          "Reports redacted Vercel REST auth scope readiness. Token, account, project, and response values are never printed.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
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

function normalizeVercelApiBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("--vercel-api-base-url must be HTTPS unless targeting localhost test server.");
  }
  return url.toString();
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
