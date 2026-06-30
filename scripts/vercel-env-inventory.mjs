#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const requiredEnvNames = [
  "UAIS_LIVE_AI_APPROVAL_TOKEN",
  "UAIS_AI_ACCESS_SIGNING_SECRET",
  "UAIS_APP_SESSION_SIGNING_SECRET",
  "UAIS_APP_AUTH_PROVIDER",
  "UAIS_APP_AUTH_PROVIDER_URL",
  "UAIS_APP_AUTH_PROVIDER_TOKEN",
  "UAIS_TEACHER_AUTH_PROVIDER",
  "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
  "UAIS_TEACHER_AUTH_ISSUER_SECRET",
  "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
  "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
  "UAIS_TEACHING_OPERATIONS_BACKEND",
  "UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND",
  "UAIS_TEACHING_COURSE_ASSETS_BACKEND",
  "UAIS_EXTERNAL_STORAGE_BASE_URL",
  "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_URL",
  "UAIS_COLLABORATION_INVITE_EMAIL_PROVIDER_TOKEN",
  "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_URL",
  "UAIS_STUDENT_ROSTER_SYNC_PROVIDER_TOKEN",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_URL",
  "UAIS_KNOWLEDGE_INDEX_SYNC_PROVIDER_TOKEN",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_URL",
  "UAIS_GRADEBOOK_RELEASE_PROVIDER_TOKEN",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_URL",
  "UAIS_COURSE_CONTENT_PUBLISH_PROVIDER_TOKEN",
  "UAIS_COURSE_EXPORT_PROVIDER",
  "UAIS_COURSE_EXPORT_PROVIDER_URL",
  "UAIS_COURSE_EXPORT_PROVIDER_TOKEN",
  "UAIS_GRADING_FEEDBACK_PROVIDER",
  "UAIS_GRADING_FEEDBACK_PROVIDER_URL",
  "UAIS_GRADING_FEEDBACK_PROVIDER_TOKEN",
  "DEEPSEEK_API_KEY",
  "DASHSCOPE_API_KEY",
];
const optionalEnvNames = [
  "UAIS_EXTERNAL_STORAGE_SERVICE_MODE",
  "UAIS_EXTERNAL_STORAGE_SERVICE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATA_DIR",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_PROVIDER_CLASS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_MIGRATION_STATUS",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_BACKUP_POLICY",
  "UAIS_EXTERNAL_STORAGE_DATABASE_ADAPTER_CONCURRENCY_CONTROL",
];
const environments = ["production", "preview"];
const maxNetworkInventoryAttempts = 3;

try {
  const options = parseArgs(process.argv.slice(2));
  const inventory = await readRemoteInventory({
    projectDir: options.projectDir,
    environments,
    method: options.method,
    vercelApiBaseUrl: options.vercelApiBaseUrl,
    vercelAuthFile: options.vercelAuthFile,
  });
  const evidence = buildEvidence({
    inventory,
    releaseRunId: options.releaseRunId,
    method: options.method,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.status !== "observed") {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Vercel env inventory failed."}\n`,
  );
  process.exitCode = 1;
}

function buildEvidence({ inventory, releaseRunId, method }) {
  const remoteEnvNames = Object.fromEntries(
    environments.map((environment) => [
      environment,
      [...inventory[environment].names].sort(),
    ]),
  );
  const remoteEnvCounts = Object.fromEntries(
    environments.map((environment) => [
      environment,
      remoteEnvNames[environment].length,
    ]),
  );
  const requiredEnvCoverage = buildEnvCoverage(requiredEnvNames, inventory);
  const optionalEnvCoverage = buildEnvCoverage(optionalEnvNames, inventory);
  const missingRequiredEnv = requiredEnvCoverage.flatMap((entry) =>
    environments.flatMap((environment) =>
      entry[environment] === "missing"
        ? [{ name: entry.name, environment, valueRedacted: true }]
        : [],
    ),
  );
  const unobservedRequiredEnv = requiredEnvCoverage.flatMap((entry) =>
    environments.flatMap((environment) =>
      entry[environment] === "unknown"
        ? [{ name: entry.name, environment, valueRedacted: true }]
        : [],
    ),
  );
  const commandStatuses = Object.fromEntries(
    environments.map((environment) => [
      environment,
      inventory[environment].status,
    ]),
  );
  const commandFailureClasses = Object.fromEntries(
    environments.map((environment) => [
      environment,
      inventory[environment].failureClass ?? "none",
    ]),
  );
  const commandAttempts = Object.fromEntries(
    environments.map((environment) => [
      environment,
      inventory[environment].attempts ?? 1,
    ]),
  );
  const blockedReasons = [
    ...(Object.values(commandStatuses).every((status) => status === "passed")
      ? []
      : ["vercel-env-inventory-command-not-passed"]),
    ...(missingRequiredEnv.length === 0
      ? []
      : ["vercel-env-inventory-required-env-missing"]),
  ];

  return {
    target: "vercel-env-inventory",
    mode: "live",
    responsibleSession: "S19",
    ...(releaseRunId ? { releaseRunId } : {}),
    status: blockedReasons.length === 0 ? "observed" : "blocked",
    environments,
    command: {
      name: method === "rest" ? "vercel-env-rest-list" : "vercel-env-list",
      format: "json",
      statusByEnvironment: commandStatuses,
      failureClassByEnvironment: commandFailureClasses,
      attemptsByEnvironment: commandAttempts,
      stdoutOmitted: true,
      stderrOmitted: true,
      ...(method === "rest" ? { apiOutputOmitted: true } : {}),
    },
    remoteEnvCounts,
    remoteEnvNames,
    requiredEnvCoverage,
    optionalEnvCoverage,
    missingRequiredEnv,
    unobservedRequiredEnv,
    blockedReasons,
    safety: {
      valuesRedacted: true,
      rawCliOutputOmitted: true,
      stderrOmitted: true,
      tokenOmitted: true,
      localPrivatePathsOmitted: true,
      noMutation: true,
    },
  };
}

function buildEnvCoverage(names, inventory) {
  return names.map((name) => ({
    name,
    ...Object.fromEntries(
      environments.map((environment) => {
        if (inventory[environment].status !== "passed") {
          return [environment, "unknown"];
        }
        return [
          environment,
          inventory[environment].names.has(name) ? "present" : "missing",
        ];
      }),
    ),
    valueRedacted: true,
  }));
}

async function readRemoteInventory({
  projectDir,
  environments,
  method,
  vercelApiBaseUrl,
  vercelAuthFile,
}) {
  if (method === "rest") {
    return readRemoteInventoryWithRestApi({
      projectDir,
      environments,
      apiBaseUrl: vercelApiBaseUrl,
      authFile: vercelAuthFile,
    });
  }

  const vercelCommand = resolveVercelCommand(resolve(projectDir ?? "."));
  return Object.fromEntries(
    environments.map((environment) => [
      environment,
      readEnvironmentInventory({ vercelCommand, projectDir, environment }),
    ]),
  );
}

async function readRemoteInventoryWithRestApi({
  projectDir,
  environments,
  apiBaseUrl,
  authFile,
}) {
  const resolvedProjectDir = resolve(projectDir ?? ".");
  let projectLink;
  let token;
  try {
    projectLink = readVercelProjectLink(resolvedProjectDir);
  } catch {
    return buildFailedInventoryForAllEnvironments(environments, "project-not-linked");
  }

  try {
    token = readVercelApiToken({ authFile });
  } catch {
    return buildFailedInventoryForAllEnvironments(environments, "auth-required");
  }

  const entries = [];
  for (const environment of environments) {
    entries.push([
      environment,
      await readEnvironmentInventoryWithRestApi({
        apiBaseUrl,
        projectLink,
        token,
        environment,
      }),
    ]);
  }
  return Object.fromEntries(entries);
}

function buildFailedInventoryForAllEnvironments(environments, failureClass) {
  return Object.fromEntries(
    environments.map((environment) => [
      environment,
      {
        status: "failed",
        failureClass,
        attempts: 1,
        names: new Set(),
        valueFieldsRedacted: true,
      },
    ]),
  );
}

async function readEnvironmentInventoryWithRestApi({
  apiBaseUrl,
  projectLink,
  token,
  environment,
}) {
  for (let attempt = 1; attempt <= maxNetworkInventoryAttempts; attempt += 1) {
    try {
      const response = await fetch(
        buildVercelEnvListUrl({ apiBaseUrl, projectLink, environment }),
        {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const body = await response.json().catch(() => undefined);
        return {
          status: "passed",
          failureClass: "none",
          attempts: attempt,
          names: readEnvNamesFromRestBody(body, environment),
          valueFieldsRedacted: true,
        };
      }

      const failureClass = classifyVercelRestInventoryFailure(response.status);
      if (failureClass === "network-error" && attempt < maxNetworkInventoryAttempts) {
        continue;
      }

      return {
        status: "failed",
        failureClass,
        attempts: attempt,
        names: new Set(),
        valueFieldsRedacted: true,
      };
    } catch {
      if (attempt < maxNetworkInventoryAttempts) {
        continue;
      }
      return {
        status: "failed",
        failureClass: "network-error",
        attempts: attempt,
        names: new Set(),
        valueFieldsRedacted: true,
      };
    }
  }

  return {
    status: "failed",
    failureClass: "unknown",
    attempts: maxNetworkInventoryAttempts,
    names: new Set(),
    valueFieldsRedacted: true,
  };
}

function buildVercelEnvListUrl({ apiBaseUrl, projectLink, environment }) {
  const url = new URL(
    `/v10/projects/${encodeURIComponent(projectLink.projectId)}/env`,
    apiBaseUrl,
  );
  url.searchParams.set("target", environment);
  if (projectLink.orgId.startsWith("team_")) {
    url.searchParams.set("teamId", projectLink.orgId);
  }
  return url;
}

function classifyVercelRestInventoryFailure(status) {
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

function readEnvironmentInventory({ vercelCommand, projectDir, environment }) {
  for (let attempt = 1; attempt <= maxNetworkInventoryAttempts; attempt += 1) {
    const result = spawnSync(
      vercelCommand,
      ["env", "ls", environment, "--format", "json", "--non-interactive"],
      {
        cwd: projectDir ?? process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status === 0) {
      return {
        status: "passed",
        failureClass: "none",
        attempts: attempt,
        names: readEnvNamesFromJsonOutput(result.stdout),
        valueFieldsRedacted: true,
      };
    }

    const failureClass = classifyVercelEnvInventoryFailure(result);
    if (failureClass === "network-error" && attempt < maxNetworkInventoryAttempts) {
      continue;
    }

    return {
      status: "failed",
      failureClass,
      attempts: attempt,
      names: new Set(),
      valueFieldsRedacted: true,
    };
  }

  return {
    status: "failed",
    failureClass: "unknown",
    attempts: maxNetworkInventoryAttempts,
    names: new Set(),
    valueFieldsRedacted: true,
  };
}

function classifyVercelEnvInventoryFailure(result) {
  if (result.error?.code === "ENOENT") {
    return "cli-not-found";
  }
  const text = [
    result.error?.message,
    typeof result.stderr === "string" ? result.stderr : "",
    typeof result.stdout === "string" ? result.stdout : "",
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (
    text.includes("unknown option") ||
    text.includes("unexpected option") ||
    text.includes("invalid option") ||
    text.includes("--format")
  ) {
    return "unsupported-format";
  }
  if (
    text.includes("not authenticated") ||
    text.includes("authentication") ||
    text.includes("auth failed") ||
    text.includes("vercel login") ||
    text.includes("login required")
  ) {
    return "auth-required";
  }
  if (
    text.includes("not linked") ||
    text.includes("project not found") ||
    text.includes("no project") ||
    text.includes("vercel link")
  ) {
    return "project-not-linked";
  }
  if (
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("enotfound") ||
    text.includes("eai_again") ||
    text.includes("econnrefused")
  ) {
    return "network-error";
  }
  return "unknown";
}

function readEnvNamesFromJsonOutput(output) {
  const json = extractJson(output);
  if (!json) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(json);
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.envs)
      ? parsed.envs
      : Array.isArray(parsed.environmentVariables)
      ? parsed.environmentVariables
      : [];
    return new Set(
      records.flatMap((record) => {
        if (!record || typeof record !== "object") {
          return [];
        }
        const name = typeof record.key === "string"
          ? record.key
          : typeof record.name === "string"
          ? record.name
          : "";
        return isSafeEnvName(name) ? [name] : [];
      }),
    );
  } catch {
    return new Set();
  }
}

function readEnvNamesFromRestBody(body, environment) {
  if (!body || typeof body !== "object") {
    return new Set();
  }
  const records = Array.isArray(body)
    ? body
    : Array.isArray(body.envs)
    ? body.envs
    : Array.isArray(body.environmentVariables)
    ? body.environmentVariables
    : Array.isArray(body.variables)
    ? body.variables
    : [];

  return new Set(
    records.flatMap((record) => {
      if (!record || typeof record !== "object") {
        return [];
      }
      if (!recordTargetsEnvironment(record, environment)) {
        return [];
      }
      const name = typeof record.key === "string"
        ? record.key
        : typeof record.name === "string"
        ? record.name
        : "";
      return isSafeEnvName(name) ? [name] : [];
    }),
  );
}

function recordTargetsEnvironment(record, environment) {
  const target = record.target ?? record.targets;
  if (typeof target === "string") {
    return target === environment;
  }
  if (Array.isArray(target)) {
    return target.length === 0 || target.includes(environment);
  }
  return true;
}

function extractJson(output) {
  if (typeof output !== "string" || output.trim() === "") {
    return "";
  }
  const trimmed = output.trim();
  const start = [...trimmed]
    .map((char, index) => (char === "[" || char === "{" ? index : -1))
    .find((index) => index >= 0);
  return start === undefined ? "" : trimmed.slice(start);
}

function isSafeEnvName(name) {
  return /^[A-Z][A-Z0-9_]{1,127}$/.test(name);
}

function resolveVercelCommand(projectDir) {
  const localBin = join(
    projectDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vercel.cmd" : "vercel",
  );
  return existsSync(localBin) ? localBin : "vercel";
}

function readVercelProjectLink(projectDir) {
  const envProjectId = process.env.VERCEL_PROJECT_ID;
  const envOrgId = process.env.VERCEL_ORG_ID;
  if (hasValue(envProjectId) && hasValue(envOrgId)) {
    return {
      projectId: envProjectId.trim(),
      orgId: envOrgId.trim(),
    };
  }

  const projectJsonPath = join(projectDir, ".vercel", "project.json");
  if (existsSync(projectJsonPath)) {
    const parsed = readJsonFile(projectJsonPath);
    if (hasValue(parsed?.projectId) && hasValue(parsed?.orgId)) {
      return {
        projectId: parsed.projectId.trim(),
        orgId: parsed.orgId.trim(),
      };
    }
  }

  const repoJsonPath = join(projectDir, ".vercel", "repo.json");
  if (existsSync(repoJsonPath)) {
    const parsed = readJsonFile(repoJsonPath);
    const project = Array.isArray(parsed?.projects) ? parsed.projects[0] : undefined;
    if (hasValue(project?.projectId) && hasValue(parsed?.orgId)) {
      return {
        projectId: project.projectId.trim(),
        orgId: parsed.orgId.trim(),
      };
    }
  }

  throw new Error("Vercel REST env inventory requires a linked project id and org id.");
}

function readVercelApiToken({ authFile }) {
  if (hasValue(process.env.VERCEL_TOKEN)) {
    return process.env.VERCEL_TOKEN.trim();
  }
  if (hasValue(process.env.VERCEL_AUTH_TOKEN)) {
    return process.env.VERCEL_AUTH_TOKEN.trim();
  }

  const candidateFiles = authFile ? [authFile] : readVercelAuthFileCandidates();
  for (const candidateFile of candidateFiles) {
    if (!existsSync(candidateFile)) {
      continue;
    }
    const parsed = readJsonFile(candidateFile);
    if (hasValue(parsed?.token)) {
      return parsed.token.trim();
    }
    if (hasValue(parsed?.authToken)) {
      return parsed.authToken.trim();
    }
  }

  throw new Error("Vercel REST env inventory requires VERCEL_TOKEN or local Vercel CLI auth.");
}

function readVercelAuthFileCandidates() {
  const home = homedir();
  return [
    join(home, ".vercel", "auth.json"),
    join(home, ".config", "vercel", "auth.json"),
    join(home, "Library", "Application Support", "com.vercel.cli", "auth.json"),
  ];
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(args) {
  const options = {
    projectDir: undefined,
    releaseRunId: undefined,
    method: "cli",
    vercelApiBaseUrl: "https://api.vercel.com",
    vercelAuthFile: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project-dir") {
      options.projectDir = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--method") {
      options.method = readInventoryMethod(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-api-base-url") {
      options.vercelApiBaseUrl = normalizeVercelApiBaseUrl(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--vercel-auth-file") {
      options.vercelAuthFile = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--release-run-id") {
      options.releaseRunId = normalizeReleaseRunId(readArgValue(args, index, arg));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/vercel-env-inventory.mjs [--method cli|rest] [--project-dir PATH] [--vercel-api-base-url URL] [--vercel-auth-file PATH] [--release-run-id ID]",
          "",
          "Outputs redacted read-only Vercel env metadata coverage. Values are never printed.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readInventoryMethod(value) {
  if (value === "cli" || value === "rest") {
    return value;
  }
  throw new Error("--method must be cli or rest.");
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

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function normalizeReleaseRunId(value) {
  const releaseRunId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(releaseRunId)) {
    throw new Error("--release-run-id must be a non-secret release identifier.");
  }
  return releaseRunId;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
