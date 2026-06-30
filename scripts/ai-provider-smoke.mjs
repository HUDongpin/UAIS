#!/usr/bin/env node

import { readFileSync } from "node:fs";

const providerRoles = [
  {
    provider: "deepseek",
    requiredEnv: "DEEPSEEK_API_KEY",
    roles: ["text-reasoning"],
    action: "verify-text-reasoning-contract",
  },
  {
    provider: "qwen",
    requiredEnv: "DASHSCOPE_API_KEY",
    roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
    action: "verify-multimodal-voice-ppt-contract",
  },
];

const deploymentEnvDefinitions = [
  {
    name: "UAIS_LIVE_AI_APPROVAL_TOKEN",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_AI_ACCESS_SIGNING_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_PROVIDER",
    provider: "uais",
    roles: [],
    valueType: "auth-provider",
  },
  {
    name: "UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AUTH_ISSUER_SECRET",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "UAIS_TEACHER_AI_OWNERSHIP_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_VOICE_LIFECYCLE_AUDIT_BACKEND",
    provider: "uais",
    roles: [],
    valueType: "storage-backend",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_BASE_URL",
    provider: "uais",
    roles: [],
    valueType: "base-url",
  },
  {
    name: "UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN",
    provider: "uais",
    roles: [],
    valueType: "secret",
  },
  {
    name: "DEEPSEEK_API_KEY",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "secret",
  },
  {
    name: "DEEPSEEK_BASE_URL",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "base-url",
    defaultValue: "https://api.deepseek.com",
  },
  {
    name: "DEEPSEEK_MODEL",
    provider: "deepseek",
    roles: ["text-reasoning"],
    valueType: "model",
    defaultValue: "deepseek-v4-flash",
  },
  {
    name: "DASHSCOPE_API_KEY",
    provider: "qwen",
    roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
    valueType: "secret",
  },
  {
    name: "DASHSCOPE_BASE_URL",
    provider: "qwen",
    roles: ["multimodal", "image-generation", "voice-clone", "ppt-narration"],
    valueType: "base-url",
    defaultValue: "https://dashscope.aliyuncs.com",
  },
  {
    name: "QWEN_MULTIMODAL_MODEL",
    provider: "qwen",
    roles: ["multimodal"],
    valueType: "model",
    defaultValue: "qwen3.5-omni-plus",
  },
  {
    name: "QWEN_IMAGE_MODEL",
    provider: "qwen",
    roles: ["image-generation"],
    valueType: "model",
    defaultValue: "qwen-image-2.0",
  },
  {
    name: "QWEN_TTS_MODEL",
    provider: "qwen",
    roles: ["voice-clone", "ppt-narration"],
    valueType: "model",
    defaultValue: "qwen3-tts-vc-realtime-2026-01-15",
  },
];

try {
  const options = parseArgs(process.argv.slice(2));
  const env = {
    ...process.env,
    ...readEnvFile(options.envFile),
  };

  if (options.deploymentEnv) {
    process.stdout.write(`${JSON.stringify(buildDeploymentEnvManifest(env), null, 2)}\n`);
    process.exit(0);
  }

  const mode = options.live ? "live" : "dry-run";

  if (mode === "live" && options.approved !== true) {
    throw new Error("Live provider smoke checks require explicit owner approval.");
  }

  const plan = {
    mode,
    network: mode === "live" ? "enabled" : "disabled",
    checks: providerRoles.map((config) => ({
      provider: config.provider,
      requiredEnv: config.requiredEnv,
      status: env[config.requiredEnv] ? "present" : "missing",
      roles: config.roles,
      action: config.action,
    })),
    safety: {
      secretsRedacted: true,
      dryRunUsesNetwork: false,
      liveRequiresApproval: true,
    },
  };

  if (mode === "live") {
    process.stdout.write(
      `${JSON.stringify({ ...plan, results: await executeLiveSmoke(env) }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Provider smoke failed."}\n`);
  process.exitCode = 1;
}

async function executeLiveSmoke(env) {
  return Promise.all([smokeDeepSeek(env), smokeQwen(env)]);
}

async function smokeDeepSeek(env) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return {
      provider: "deepseek",
      status: "skipped",
      reason: "missing-required-env",
    };
  }

  const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const baseUrl = stripTrailingSlash(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: false,
    }),
  });

  return {
    provider: "deepseek",
    status: response.ok ? "ok" : "failed",
    httpStatus: response.status,
    model,
  };
}

async function smokeQwen(env) {
  const apiKey = env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return {
      provider: "qwen",
      status: "skipped",
      reason: "missing-required-env",
    };
  }

  const model = env.QWEN_MULTIMODAL_MODEL || "qwen3.5-omni-plus";
  const baseUrl = qwenCompatibleBaseUrl(env.DASHSCOPE_BASE_URL);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: false,
    }),
  });

  return {
    provider: "qwen",
    status: response.ok ? "ok" : "failed",
    httpStatus: response.status,
    model,
  };
}

function qwenCompatibleBaseUrl(baseUrl) {
  const normalized = stripTrailingSlash(baseUrl || "https://dashscope.aliyuncs.com");
  if (normalized.endsWith("/compatible-mode/v1")) {
    return normalized;
  }

  return `${normalized}/compatible-mode/v1`;
}

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    envFile: undefined,
    deploymentEnv: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.live = false;
    } else if (arg === "--deployment-env") {
      options.deploymentEnv = true;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--approved") {
      options.approved = true;
    } else if (arg === "--env-file") {
      const envFile = args[index + 1];
      if (!envFile) {
        throw new Error("--env-file requires a path.");
      }
      options.envFile = envFile;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/ai-provider-smoke.mjs [--dry-run] [--deployment-env] [--live --approved] [--env-file PATH]",
          "",
          "Outputs redacted provider readiness or deployment-env JSON. Dry-run and deployment-env modes never use network.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function buildDeploymentEnvManifest(env) {
  return {
    target: "vercel",
    responsibleSession: "S19",
    entries: deploymentEnvDefinitions.map((definition) => ({
      ...definition,
      status: hasValue(env[definition.name]) ? "present" : "missing",
      serverOnly: true,
      vercelTargets: ["production", "preview"],
    })),
    safety: {
      valuesRedacted: true,
      nextPublicForbidden: true,
      liveProviderApprovalRequired: true,
    },
  };
}

function readEnvFile(envFile) {
  if (!envFile) {
    return {};
  }

  const parsed = {};
  const content = readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      parsed[key] = stripQuotes(value);
    }
  }

  return parsed;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}
