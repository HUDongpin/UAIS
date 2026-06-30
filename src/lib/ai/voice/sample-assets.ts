import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import type {
  TeacherVoiceConsentScope,
  TeacherVoiceSampleSourceKind,
} from "@/lib/ai/voice/sample-intake";

export type StoreTeacherVoiceSampleAssetInput = {
  baseDir?: string;
  teacherId: string;
  sampleAssetId: string;
  sampleDurationSeconds: number;
  consentScope: TeacherVoiceConsentScope;
  sourceKind: TeacherVoiceSampleSourceKind;
  mimeType: string;
  audioBase64: string;
  createdAt?: string;
};

export type StoredTeacherVoiceSampleAsset = {
  assetId: string;
  teacherId: string;
  provider: "qwen";
  providerRole: "voice-clone";
  status: "stored";
  mimeType: string;
  byteLength: number;
  sampleDurationSeconds: number;
  consentScope: TeacherVoiceConsentScope;
  sourceKind: TeacherVoiceSampleSourceKind;
  storagePolicy: "local-private-audio-asset";
  dataUrlRef: "server-side-only";
  responsibleSession: "S24/S12";
  retention: TeacherVoiceSampleRetentionPolicy;
  provenance: TeacherVoiceSampleProvenance;
};

export type TeacherVoiceSampleRetentionPolicy = {
  classification: "teacher-voice-biometric-sensitive";
  policy: "delete-source-sample-after-30-days-or-owner-request";
  createdAt: string;
  deleteAfter: string;
  deleteAfterDays: 30;
  responsibleSession: "S24";
};

export type TeacherVoiceSampleProvenance = {
  sourceKind: TeacherVoiceSampleSourceKind;
  consentScope: TeacherVoiceConsentScope;
  consentRecord: "owner-confirmed-for-ppt-narration";
  provider: "qwen";
  providerRole: "voice-clone";
};

export type TeacherVoiceSampleAssetRead = {
  bytes: Buffer;
  contentType: string;
  filename: string;
  byteLength: number;
  dataUrl: string;
};

const DEFAULT_TEACHER_VOICE_SAMPLE_DIR = join(
  cwd(),
  ".tmp",
  "uais-ai-assets",
  "teacher-voice-samples",
);

export async function storeTeacherVoiceSampleAsset(
  input: StoreTeacherVoiceSampleAssetInput,
): Promise<StoredTeacherVoiceSampleAsset> {
  if (input.consentScope !== "ppt-narration") {
    throw new Error("Teacher voice sample consent scope must be ppt-narration.");
  }
  if (input.sampleDurationSeconds < 10) {
    throw new Error("Teacher voice sample must be at least 10 seconds long.");
  }
  if (!input.mimeType.startsWith("audio/")) {
    throw new Error("Teacher voice sample must be an audio asset.");
  }

  const baseDir = resolveTeacherVoiceSampleBaseDir(input.baseDir);
  const teacherId = requireSafeId(input.teacherId, "teacher id");
  const assetId = requireSafeId(input.sampleAssetId, "sample asset id");
  const extension = extensionForMimeType(input.mimeType);
  const teacherDir = resolve(baseDir, teacherId);
  ensureWithinBase(baseDir, teacherDir);
  await mkdir(teacherDir, { recursive: true });

  const bytes = Buffer.from(input.audioBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("Teacher voice sample audio payload is empty.");
  }
  const retention = createTeacherVoiceSampleRetentionPolicy(input.createdAt);

  const audioPath = resolve(teacherDir, `${assetId}.${extension}`);
  ensureWithinBase(teacherDir, audioPath);
  await writeFile(audioPath, bytes);

  const stored: StoredTeacherVoiceSampleAsset = {
    assetId,
    teacherId,
    provider: "qwen",
    providerRole: "voice-clone",
    status: "stored",
    mimeType: input.mimeType,
    byteLength: bytes.byteLength,
    sampleDurationSeconds: input.sampleDurationSeconds,
    consentScope: input.consentScope,
    sourceKind: input.sourceKind,
    storagePolicy: "local-private-audio-asset",
    dataUrlRef: "server-side-only",
    responsibleSession: "S24/S12",
    retention,
    provenance: {
      sourceKind: input.sourceKind,
      consentScope: input.consentScope,
      consentRecord: "owner-confirmed-for-ppt-narration",
      provider: "qwen",
      providerRole: "voice-clone",
    },
  };
  await writeFile(resolve(teacherDir, `${assetId}.json`), JSON.stringify(stored, null, 2));
  return stored;
}

export async function readTeacherVoiceSampleAsset(input: {
  baseDir?: string;
  teacherId: string;
  sampleAssetId: string;
}): Promise<TeacherVoiceSampleAssetRead> {
  const baseDir = resolveTeacherVoiceSampleBaseDir(input.baseDir);
  const teacherId = requireSafeId(input.teacherId, "teacher id");
  const assetId = requireSafeId(input.sampleAssetId, "sample asset id");
  const teacherDir = resolve(baseDir, teacherId);
  ensureWithinBase(baseDir, teacherDir);
  const metadataPath = resolve(teacherDir, `${assetId}.json`);
  ensureWithinBase(teacherDir, metadataPath);

  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as StoredTeacherVoiceSampleAsset;
  const extension = extensionForMimeType(metadata.mimeType);
  const filename = `${assetId}.${extension}`;
  const audioPath = resolve(teacherDir, filename);
  ensureWithinBase(teacherDir, audioPath);
  const bytes = await readFile(audioPath);

  return {
    bytes,
    contentType: metadata.mimeType,
    filename,
    byteLength: bytes.byteLength,
    dataUrl: `data:${metadata.mimeType};base64,${bytes.toString("base64")}`,
  };
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/aac":
      return "aac";
    case "audio/flac":
      return "flac";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "webm";
    default:
      throw new Error("Unsupported teacher voice sample audio MIME type.");
  }
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function resolveTeacherVoiceSampleBaseDir(baseDir?: string) {
  return baseDir ? resolve(baseDir) : DEFAULT_TEACHER_VOICE_SAMPLE_DIR;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved teacher voice sample path escapes the configured storage directory.");
  }
}

function createTeacherVoiceSampleRetentionPolicy(
  createdAt = new Date().toISOString(),
): TeacherVoiceSampleRetentionPolicy {
  return {
    classification: "teacher-voice-biometric-sensitive",
    policy: "delete-source-sample-after-30-days-or-owner-request",
    createdAt,
    deleteAfter: addDaysIso(createdAt, 30),
    deleteAfterDays: 30,
    responsibleSession: "S24",
  };
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error("createdAt must be a valid ISO date.");
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
