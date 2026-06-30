#!/usr/bin/env node

import { mkdir, readFile, unlink, writeFile, appendFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_REGISTRY_DIR = join(cwd(), ".tmp", "uais-ai-assets", "qwen-cloned-voices");
const DISPOSABLE_VOICE_REF_PREFIX = "qwen-voice-ref-disposable-";
const UNSAFE_PATTERNS = [
  /sk-[A-Za-z0-9]/,
  /(?:DASHSCOPE_API_KEY|DEEPSEEK_API_KEY|UAIS_LIVE_AI_APPROVAL_TOKEN|UAIS_AI_ACCESS_SIGNING_SECRET|UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET|UAIS_TEACHER_AUTH_ISSUER_SECRET)\s*=\s*[^"',}\]\s]+/,
  /\/Users\/dongpinhu\/Library\/Containers/,
  /data:audio\/[^"',}\]\s]+base64/i,
  /audioBase64/i,
];

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.live && options.approved !== true) {
    throw new Error("Qwen disposable voice revoke smoke requires explicit owner approval.");
  }
  if (options.voiceRefId) {
    assertDisposableVoiceRefId(options.voiceRefId);
  }

  const mode = options.live ? "live" : "dry-run";
  const registryDir = resolve(options.registryDir ?? DEFAULT_REGISTRY_DIR);
  const env = options.live
    ? {
        ...process.env,
        ...readEnvFile(options.envFile),
      }
    : process.env;
  const plan = buildSmokePlan({
    mode,
    voiceRefId: options.voiceRefId,
    registryDir,
    qwenEnvPresent: hasValue(env.DASHSCOPE_API_KEY),
  });

  if (mode === "dry-run") {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(0);
  }

  assertLivePrerequisites({ env, voiceRefId: options.voiceRefId });
  const result = await revokeDisposableVoiceReference({
    registryDir,
    voiceRefId: options.voiceRefId,
    apiKey: env.DASHSCOPE_API_KEY,
    baseUrl: options.baseUrl ?? env.DASHSCOPE_BASE_URL ?? DEFAULT_DASHSCOPE_BASE_URL,
  });

  process.stdout.write(`${JSON.stringify({ ...plan, ...result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Qwen revoke smoke failed."}\n`);
  process.exitCode = 1;
}

function buildSmokePlan({ mode, voiceRefId, registryDir, qwenEnvPresent }) {
  const recordPath = voiceRefId ? resolve(registryDir, `${voiceRefId}.json`) : undefined;
  if (recordPath) {
    ensureWithinBase(registryDir, recordPath);
  }

  return {
    target: "qwen-disposable-voice-revoke-smoke",
    mode,
    network: mode === "live" ? "enabled" : "disabled",
    responsibleSession: "S24/S12",
    voiceRefId: voiceRefId ?? "missing",
    prerequisites: [
      {
        id: "s24-disposable-voice-ref-id",
        responsibleSession: "S24",
        status: voiceRefId?.startsWith(DISPOSABLE_VOICE_REF_PREFIX) ? "present" : "missing",
      },
      {
        id: "s24-local-private-reference",
        responsibleSession: "S24",
        status: recordPath && existsSync(recordPath) ? "present" : "missing",
      },
      {
        id: "s19-qwen-env",
        responsibleSession: "S19",
        requiredEnv: "DASHSCOPE_API_KEY",
        status: qwenEnvPresent ? "present" : "missing",
      },
    ],
    safety: {
      disposableVoiceRefOnly: true,
      acceptedVoiceRefPrefix: DISPOSABLE_VOICE_REF_PREFIX,
      secretsRedacted: true,
      privateVoiceIdRedacted: true,
      localPathsOmitted: true,
      liveRequiresApproval: true,
    },
  };
}

async function revokeDisposableVoiceReference({ registryDir, voiceRefId, apiKey, baseUrl }) {
  assertDisposableVoiceRefId(voiceRefId);
  const referencePath = resolve(registryDir, `${voiceRefId}.json`);
  ensureWithinBase(registryDir, referencePath);
  const reference = JSON.parse(await readFile(referencePath, "utf8"));
  validatePrivateReference(reference, voiceRefId);

  const providerRevocation = await revokeProviderVoice({
    apiKey,
    baseUrl,
    clonedVoiceId: reference.clonedVoiceId,
  });
  await unlink(referencePath);
  await writeLocalDeletionAudit({
    registryDir,
    publicReference: reference.publicReference,
  });
  await appendLifecycleAudit({
    registryDir,
    publicReference: reference.publicReference,
    requestId: providerRevocation.requestId,
  });

  return {
    status: "revoked-and-deleted",
    providerRevocation,
    localReference: {
      status: "deleted",
    },
    audit: {
      localDeletionRecord: "written",
      lifecycleEvent: "written",
    },
    redaction: createRedaction(),
  };
}

async function revokeProviderVoice({ apiKey, baseUrl, clonedVoiceId }) {
  const response = await fetch(`${stripTrailingSlash(baseUrl)}/api/v1/services/audio/tts/customization`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "qwen-voice-enrollment",
      input: {
        action: "delete",
        voice: clonedVoiceId,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  let requestId;
  try {
    const body = await response.json();
    requestId = typeof body?.request_id === "string" ? body.request_id : undefined;
  } catch {
    requestId = undefined;
  }

  if (!response.ok) {
    throw new Error(`Qwen disposable voice revoke failed with HTTP ${response.status}.`);
  }

  return {
    status: "revoked",
    provider: "qwen",
    providerRole: "voice-clone",
    httpStatus: response.status,
    ...(requestId ? { requestId: requireSafePublicId(requestId, "provider request id") } : {}),
  };
}

async function writeLocalDeletionAudit({ registryDir, publicReference }) {
  const auditDir = resolve(registryDir, ".deletion-audit");
  ensureWithinBase(registryDir, auditDir);
  await mkdir(auditDir, { recursive: true });
  const auditPath = resolve(auditDir, `${publicReference.voiceRefId}.json`);
  ensureWithinBase(auditDir, auditPath);
  await writeFile(
    auditPath,
    JSON.stringify(
      {
        auditId: `qwen-cloned-voice-revocation-${publicReference.voiceRefId}`,
        voiceRefId: publicReference.voiceRefId,
        deletionReason: "owner-request",
        deletedAt: new Date().toISOString(),
        providerRevocation: {
          status: "revoked",
        },
        localReference: {
          status: "deleted",
        },
        responsibleSession: "S24/S12",
        redaction: createRedaction(),
      },
      null,
      2,
    ),
  );
}

async function appendLifecycleAudit({ registryDir, publicReference, requestId }) {
  const auditDir = resolve(registryDir, ".lifecycle-audit");
  ensureWithinBase(registryDir, auditDir);
  await mkdir(auditDir, { recursive: true });
  const auditPath = resolve(auditDir, "qwen-voice-lifecycle-audit.jsonl");
  ensureWithinBase(auditDir, auditPath);
  const event = {
    eventId: `qwen-voice-lifecycle-${publicReference.voiceRefId}-${Date.now()}`,
    eventType: "qwen-voice-lifecycle",
    provider: "qwen",
    providerRole: "voice-clone",
    action: "voice-clone-revoke",
    status: "recorded",
    occurredAt: new Date().toISOString(),
    actor: {
      actorId: "s24-disposable-revoke-smoke",
      role: "admin",
    },
    resource: {
      teacherId: publicReference.teacherId,
      sampleAssetId: publicReference.sampleAssetId,
      voiceRefId: publicReference.voiceRefId,
    },
    deletionReason: "owner-request",
    providerRevocation: {
      status: "revoked",
      ...(requestId ? { requestId } : {}),
    },
    localReference: {
      status: "deleted",
    },
    localAuditRecord: {
      auditId: `qwen-cloned-voice-revocation-${publicReference.voiceRefId}`,
      storagePolicy: "local-redacted-lifecycle-audit",
    },
    storagePolicy: "append-only-redacted-lifecycle-audit",
    responsibleSession: "S12/S24",
    redaction: createRedaction(),
  };
  assertSerializedSafe(event);
  await appendFile(auditPath, `${JSON.stringify(event)}\n`, "utf8");
}

function validatePrivateReference(reference, voiceRefId) {
  if (reference?.publicReference?.voiceRefId !== voiceRefId) {
    throw new Error("Stored Qwen voice reference does not match the requested disposable voiceRef.");
  }
  if (reference.publicReference.provider !== "qwen" || reference.publicReference.providerRole !== "voice-clone") {
    throw new Error("Stored disposable voice reference is not a Qwen voice-clone reference.");
  }
  if (!hasValue(reference.clonedVoiceId)) {
    throw new Error("Stored disposable voice reference is missing the private provider voice id.");
  }
}

function assertLivePrerequisites({ env, voiceRefId }) {
  if (!voiceRefId) {
    throw new Error("Qwen disposable voice revoke smoke requires --voice-ref-id.");
  }
  if (!hasValue(env.DASHSCOPE_API_KEY)) {
    throw new Error("Qwen disposable voice revoke smoke requires DASHSCOPE_API_KEY.");
  }
}

function assertDisposableVoiceRefId(voiceRefId) {
  if (!hasValue(voiceRefId) || !voiceRefId.startsWith(DISPOSABLE_VOICE_REF_PREFIX)) {
    throw new Error(`Qwen revoke smoke only accepts disposable voiceRef ids with prefix ${DISPOSABLE_VOICE_REF_PREFIX}.`);
  }
  requireSafePublicId(voiceRefId, "voice reference id");
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    envFile: undefined,
    voiceRefId: undefined,
    registryDir: undefined,
    baseUrl: undefined,
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
      options.envFile = requireNextArg(args, index, "--env-file");
      index += 1;
    } else if (arg === "--voice-ref-id") {
      options.voiceRefId = requireNextArg(args, index, "--voice-ref-id");
      index += 1;
    } else if (arg === "--registry-dir") {
      options.registryDir = requireNextArg(args, index, "--registry-dir");
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = requireNextArg(args, index, "--base-url");
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/qwen-voice-revoke-smoke.mjs [--dry-run] [--live --approved --voice-ref-id ID] [--registry-dir DIR] [--base-url URL] [--env-file PATH]",
          "",
          "Runs a redacted Qwen disposable cloned-voice revoke smoke. Live mode accepts only qwen-voice-ref-disposable-* references.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireNextArg(args, index, flag) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
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

function ensureWithinBase(baseDir, targetPath) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved Qwen revoke smoke path escapes the configured directory.");
  }
}

function requireSafePublicId(value, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function assertSerializedSafe(value) {
  const serialized = JSON.stringify(value);
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Qwen revoke smoke output contains non-auditable private data.");
  }
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

function stripTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
