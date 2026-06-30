#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { cwd } from "node:process";

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_REGISTRY_DIR = join(cwd(), ".tmp", "uais-ai-assets", "qwen-cloned-voices");
const DEFAULT_TARGET_MODEL = "qwen3-tts-vc-realtime-2026-01-15";
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
    throw new Error("Qwen disposable voice create smoke requires explicit owner approval.");
  }

  const mode = options.live ? "live" : "dry-run";
  const registryDir = resolve(options.registryDir ?? DEFAULT_REGISTRY_DIR);
  const targetModel = options.targetModel ?? DEFAULT_TARGET_MODEL;
  const voiceRefId = buildDisposableVoiceRefId({
    teacherId: options.teacherId,
    sampleAssetId: options.sampleAssetId,
  });
  const env = options.live
    ? {
        ...process.env,
        ...readEnvFile(options.envFile),
      }
    : process.env;
  const plan = buildSmokePlan({
    mode,
    voiceRefId,
    teacherId: options.teacherId,
    sampleAssetId: options.sampleAssetId,
    registryDir,
    targetModel,
    qwenEnvPresent: hasValue(env.DASHSCOPE_API_KEY),
  });

  if (mode === "dry-run") {
    writeSafeJson(plan);
    process.exit(0);
  }

  assertLivePrerequisites({
    env,
    teacherId: options.teacherId,
    sampleAssetId: options.sampleAssetId,
    sampleAudio: options.sampleAudio,
    sampleText: options.sampleText,
  });
  const result = await createDisposableVoiceReference({
    registryDir,
    voiceRefId,
    teacherId: options.teacherId,
    sampleAssetId: options.sampleAssetId,
    sampleAudio: options.sampleAudio,
    sampleText: options.sampleText,
    apiKey: env.DASHSCOPE_API_KEY,
    baseUrl: options.baseUrl ?? env.DASHSCOPE_BASE_URL ?? DEFAULT_DASHSCOPE_BASE_URL,
    targetModel,
    preferredName: options.preferredName,
  });

  writeSafeJson({ ...plan, ...result });
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Qwen disposable voice create smoke failed."}\n`);
  process.exitCode = 1;
}

function buildSmokePlan({ mode, voiceRefId, teacherId, sampleAssetId, registryDir, targetModel, qwenEnvPresent }) {
  const recordPath = resolve(registryDir, `${voiceRefId}.json`);
  ensureWithinBase(registryDir, recordPath);

  return {
    target: "qwen-disposable-voice-create-smoke",
    mode,
    network: mode === "live" ? "enabled" : "disabled",
    responsibleSession: "S24/S12",
    voiceRefId,
    provider: "qwen",
    providerRole: "voice-clone",
    targetModel,
    prerequisites: [
      {
        id: "s24-disposable-teacher-id",
        responsibleSession: "S24",
        status: isDisposableTeacherId(teacherId) ? "present" : "missing",
      },
      {
        id: "s24-disposable-sample-asset-id",
        responsibleSession: "S24",
        status: isDisposableSmokeSampleId(sampleAssetId) ? "present" : "missing",
      },
      {
        id: "s19-qwen-env",
        responsibleSession: "S19",
        requiredEnv: "DASHSCOPE_API_KEY",
        status: qwenEnvPresent ? "present" : "missing",
      },
      {
        id: "s24-local-private-reference",
        responsibleSession: "S24",
        status: existsSync(recordPath) ? "present" : "missing",
      },
    ],
    safety: {
      disposableVoiceRefPrefix: DISPOSABLE_VOICE_REF_PREFIX,
      disposableVoiceRefCreated: mode === "live",
      privateVoiceIdRedacted: true,
      sampleAudioRedacted: true,
      secretsRedacted: true,
      localPathsOmitted: true,
      liveRequiresApproval: true,
    },
  };
}

async function createDisposableVoiceReference(input) {
  assertDisposableTeacherId(input.teacherId);
  assertDisposableSmokeSampleId(input.sampleAssetId);
  assertDisposableVoiceRefId(input.voiceRefId);
  const sampleAudioDataUrl = await readSampleAudioDataUrl(input.sampleAudio);
  const providerEnrollment = await submitVoiceEnrollment({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    targetModel: input.targetModel,
    preferredName: input.preferredName ?? createPreferredVoiceName(input.teacherId),
    sampleAudioDataUrl,
    sampleText: input.sampleText,
  });
  await storePrivateVoiceReference({
    registryDir: input.registryDir,
    voiceRefId: input.voiceRefId,
    teacherId: input.teacherId,
    sampleAssetId: input.sampleAssetId,
    clonedVoiceId: providerEnrollment.clonedVoiceId,
    providerTaskId: providerEnrollment.requestId ?? input.voiceRefId,
    targetModel: providerEnrollment.targetModel ?? input.targetModel,
  });

  return {
    status: "created",
    providerEnrollment: {
      provider: "qwen",
      providerRole: "voice-clone",
      status: "submitted",
      httpStatus: providerEnrollment.httpStatus,
      ...(providerEnrollment.requestId ? { requestId: providerEnrollment.requestId } : {}),
      targetModel: providerEnrollment.targetModel ?? input.targetModel,
    },
    localReference: {
      status: "stored",
      storagePolicy: "local-private-cloned-voice-reference",
    },
    redaction: createRedaction(),
    safety: {
      disposableVoiceRefCreated: true,
      privateVoiceIdRedacted: true,
      sampleAudioRedacted: true,
      liveRequiresApproval: true,
    },
  };
}

async function submitVoiceEnrollment({ apiKey, baseUrl, targetModel, preferredName, sampleAudioDataUrl, sampleText }) {
  const response = await fetch(`${stripTrailingSlash(baseUrl)}/api/v1/services/audio/tts/customization`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "qwen-voice-enrollment",
      input: {
        action: "create",
        target_model: targetModel,
        preferred_name: preferredName,
        audio: {
          data: sampleAudioDataUrl,
        },
        text: sampleText,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(`Qwen disposable voice create failed with HTTP ${response.status}.`);
  }

  const clonedVoiceId = body?.output?.voice ?? body?.output?.voice_id ?? body?.output?.cloned_voice_id;
  if (!hasValue(clonedVoiceId)) {
    throw new Error("Qwen disposable voice create response did not include a provider voice id.");
  }

  return {
    httpStatus: response.status,
    clonedVoiceId,
    requestId: hasValue(body?.request_id) ? requireSafePublicId(body.request_id, "provider request id") : undefined,
    targetModel: hasValue(body?.output?.target_model) ? body.output.target_model : targetModel,
  };
}

async function storePrivateVoiceReference({
  registryDir,
  voiceRefId,
  teacherId,
  sampleAssetId,
  clonedVoiceId,
  providerTaskId,
  targetModel,
}) {
  const baseDir = resolve(registryDir);
  const filePath = resolve(baseDir, `${voiceRefId}.json`);
  ensureWithinBase(baseDir, filePath);
  await mkdir(baseDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const publicReference = {
    voiceRefId,
    teacherId,
    sampleAssetId,
    provider: "qwen",
    providerRole: "voice-clone",
    status: "ready",
    providerTaskId,
    targetModel,
    voiceRef: "server-side-cloned-qwen-voice",
    storagePolicy: "local-private-cloned-voice-reference",
    responsibleSession: "S07/S12/S24",
    retention: {
      classification: "provider-cloned-voice-reference-sensitive",
      policy: "revoke-provider-voice-and-delete-reference-on-owner-request-or-sample-expiry",
      createdAt,
      reviewAfter: addDaysIso(createdAt, 30),
      reviewAfterDays: 30,
      deletionTrigger: "owner-request-or-source-sample-deletion",
      responsibleSession: "S24",
    },
    provenance: {
      provider: "qwen",
      providerRole: "voice-clone",
      sourceSampleAssetId: sampleAssetId,
      providerTaskId,
      voiceRef: "server-side-cloned-qwen-voice",
      privateProviderVoiceId: "server-side-only",
    },
  };
  await writeFile(
    filePath,
    JSON.stringify(
      {
        publicReference,
        clonedVoiceId,
      },
      null,
      2,
    ),
  );
}

async function readSampleAudioDataUrl(sampleAudio) {
  const mimeType = mimeTypeForAudioPath(sampleAudio);
  const bytes = await readFile(sampleAudio);
  if (bytes.byteLength === 0) {
    throw new Error("Qwen disposable voice create smoke requires a non-empty sample audio file.");
  }
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function mimeTypeForAudioPath(sampleAudio) {
  const extension = extname(sampleAudio).toLowerCase();
  if (extension === ".wav") return "audio/wav";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".aac") return "audio/aac";
  if (extension === ".aiff" || extension === ".aif") return "audio/aiff";
  throw new Error("Qwen disposable voice create smoke requires a known audio file extension.");
}

function assertLivePrerequisites({ env, teacherId, sampleAssetId, sampleAudio, sampleText }) {
  assertDisposableTeacherId(teacherId);
  assertDisposableSmokeSampleId(sampleAssetId);
  if (!hasValue(env.DASHSCOPE_API_KEY)) {
    throw new Error("Qwen disposable voice create smoke requires DASHSCOPE_API_KEY.");
  }
  if (!hasValue(sampleAudio)) {
    throw new Error("Qwen disposable voice create smoke requires --sample-audio.");
  }
  if (!hasValue(sampleText)) {
    throw new Error("Qwen disposable voice create smoke requires --sample-text.");
  }
}

function buildDisposableVoiceRefId({ teacherId, sampleAssetId }) {
  requireSafePublicId(teacherId, "teacher id");
  requireSafePublicId(sampleAssetId, "sample asset id");
  return `${DISPOSABLE_VOICE_REF_PREFIX}${teacherId}-${sampleAssetId}`;
}

function assertDisposableVoiceRefId(voiceRefId) {
  if (!hasValue(voiceRefId) || !voiceRefId.startsWith(DISPOSABLE_VOICE_REF_PREFIX)) {
    throw new Error(`Qwen create smoke only creates disposable voiceRef ids with prefix ${DISPOSABLE_VOICE_REF_PREFIX}.`);
  }
  requireSafePublicId(voiceRefId, "voice reference id");
}

function assertDisposableTeacherId(teacherId) {
  if (!isDisposableTeacherId(teacherId)) {
    throw new Error("Qwen disposable voice create smoke requires a teacher id starting with disposable-.");
  }
  requireSafePublicId(teacherId, "teacher id");
}

function isDisposableTeacherId(teacherId) {
  return hasValue(teacherId) && teacherId.startsWith("disposable-");
}

function assertDisposableSmokeSampleId(sampleAssetId) {
  if (!isDisposableSmokeSampleId(sampleAssetId)) {
    throw new Error("Qwen disposable voice create smoke requires a sample asset id starting with s24-delete-smoke-.");
  }
  requireSafePublicId(sampleAssetId, "sample asset id");
}

function isDisposableSmokeSampleId(sampleAssetId) {
  return hasValue(sampleAssetId) && sampleAssetId.startsWith("s24-delete-smoke-");
}

function createPreferredVoiceName(label) {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);

  return normalized || "disposable_voice";
}

function parseArgs(args) {
  const options = {
    live: false,
    approved: false,
    envFile: undefined,
    teacherId: undefined,
    sampleAssetId: undefined,
    sampleAudio: undefined,
    sampleText: undefined,
    registryDir: undefined,
    baseUrl: undefined,
    targetModel: undefined,
    preferredName: undefined,
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
    } else if (arg === "--teacher-id") {
      options.teacherId = requireNextArg(args, index, "--teacher-id");
      index += 1;
    } else if (arg === "--sample-asset-id") {
      options.sampleAssetId = requireNextArg(args, index, "--sample-asset-id");
      index += 1;
    } else if (arg === "--sample-audio") {
      options.sampleAudio = requireNextArg(args, index, "--sample-audio");
      index += 1;
    } else if (arg === "--sample-text") {
      options.sampleText = requireNextArg(args, index, "--sample-text");
      index += 1;
    } else if (arg === "--registry-dir") {
      options.registryDir = requireNextArg(args, index, "--registry-dir");
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = requireNextArg(args, index, "--base-url");
      index += 1;
    } else if (arg === "--target-model") {
      options.targetModel = requireNextArg(args, index, "--target-model");
      index += 1;
    } else if (arg === "--preferred-name") {
      options.preferredName = requireNextArg(args, index, "--preferred-name");
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node -- scripts/qwen-voice-disposable-create-smoke.mjs [--dry-run] [--live --approved --teacher-id disposable-* --sample-asset-id s24-delete-smoke-* --sample-audio PATH --sample-text TEXT] [--registry-dir DIR] [--base-url URL] [--env-file PATH]",
          "",
          "Runs a redacted Qwen disposable cloned-voice create smoke. Live mode creates only qwen-voice-ref-disposable-* local references.",
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
    throw new Error("Resolved Qwen disposable create smoke path escapes the configured directory.");
  }
}

function requireSafePublicId(value, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function writeSafeJson(value) {
  assertSerializedSafe(value);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function assertSerializedSafe(value) {
  const serialized = JSON.stringify(value);
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Qwen disposable voice create smoke output contains non-auditable private data.");
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

function addDaysIso(isoDate, days) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error("createdAt must be a valid ISO date.");
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
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
