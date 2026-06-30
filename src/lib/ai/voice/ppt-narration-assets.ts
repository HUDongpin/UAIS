import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import type { Locale } from "@/i18n/copy";
import type { PptNarrationAudioManifest } from "@/lib/ai/voice/ppt-narration";

export type PptNarrationAudioSegmentOutput = {
  slideId: string;
  audioId: string;
  audioBase64: string;
  byteLength: number;
  format: "pcm";
  sampleRateHz: 24000;
};

export type StoredPptNarrationAudioAsset = {
  slideId: string;
  audioId: string;
  format: "wav";
  sampleRateHz: 24000;
  byteLength: number;
  downloadUrl: string;
};

export type StoredPptNarrationAudioManifest = {
  id: string;
  provider: "qwen";
  providerRole: "ppt-narration";
  targetModel: string;
  courseId: string;
  pptAssetId: string;
  language: Locale;
  voiceRef: "server-side-cloned-qwen-voice";
  sourcePattern: "openmaic-audio-id-download-assets";
  retention: PptNarrationAudioRetentionPolicy;
  provenance: PptNarrationAudioProvenance;
  assets: StoredPptNarrationAudioAsset[];
};

export type StorePptNarrationAudioAssetsInput = {
  manifest: PptNarrationAudioManifest;
  audioSegments: PptNarrationAudioSegmentOutput[];
  baseDir?: string;
  createdAt?: string;
};

export type PptNarrationAudioAssetRead = {
  bytes: Buffer;
  contentType: "audio/wav";
  filename: string;
  byteLength: number;
};

export type PptNarrationAudioRetentionPolicy = {
  classification: "course-ppt-narration-derived-audio";
  policy: "retain-derived-audio-for-365-days-or-owner-request";
  createdAt: string;
  deleteAfter: string;
  deleteAfterDays: 365;
  responsibleSession: "S24";
};

export type PptNarrationAudioProvenance = {
  provider: "qwen";
  providerRole: "ppt-narration";
  sourcePattern: "openmaic-audio-id-download-assets";
  voiceRef: "server-side-cloned-qwen-voice";
  generatedFrom: "qwen-realtime-tts";
};

const DEFAULT_AUDIO_ASSET_DIR = join(cwd(), ".tmp", "uais-ai-assets", "ppt-narration");

export async function storePptNarrationAudioAssets(
  input: StorePptNarrationAudioAssetsInput,
): Promise<StoredPptNarrationAudioManifest> {
  const baseDir = resolveAudioAssetBaseDir(input.baseDir);
  const manifestId = requireSafeId(input.manifest.id, "manifest id");
  const manifestDir = resolve(baseDir, manifestId);
  ensureWithinBase(baseDir, manifestDir);
  await mkdir(manifestDir, { recursive: true });

  const assets: StoredPptNarrationAudioAsset[] = [];
  for (const segment of input.manifest.segments) {
    const audio = input.audioSegments.find((candidate) => candidate.audioId === segment.audioId);
    if (!audio) {
      throw new Error(`Missing synthesized audio for ${segment.audioId}.`);
    }
    if (audio.format !== "pcm" || audio.sampleRateHz !== 24000) {
      throw new Error("PPT narration audio assets must be 24 kHz PCM before WAV wrapping.");
    }

    const audioId = requireSafeId(segment.audioId, "audio id");
    const pcmBytes = Buffer.from(audio.audioBase64, "base64");
    const wavBytes = createPcm16MonoWav(pcmBytes, audio.sampleRateHz);
    const filename = `${audioId}.wav`;
    const filePath = resolve(manifestDir, filename);
    ensureWithinBase(manifestDir, filePath);
    await writeFile(filePath, wavBytes);

    assets.push({
      slideId: segment.slideId,
      audioId,
      format: "wav",
      sampleRateHz: 24000,
      byteLength: wavBytes.byteLength,
      downloadUrl: `/api/ai/ppt-narration/audio/${manifestId}/${audioId}`,
    });
  }

  const storedManifest: StoredPptNarrationAudioManifest = {
    id: manifestId,
    provider: "qwen",
    providerRole: "ppt-narration",
    targetModel: input.manifest.targetModel,
    courseId: input.manifest.courseId,
    pptAssetId: input.manifest.pptAssetId,
    language: input.manifest.language,
    voiceRef: "server-side-cloned-qwen-voice",
    sourcePattern: "openmaic-audio-id-download-assets",
    retention: createPptNarrationAudioRetentionPolicy(input.createdAt),
    provenance: {
      provider: "qwen",
      providerRole: "ppt-narration",
      sourcePattern: "openmaic-audio-id-download-assets",
      voiceRef: "server-side-cloned-qwen-voice",
      generatedFrom: "qwen-realtime-tts",
    },
    assets,
  };
  await writeFile(join(manifestDir, "manifest.json"), JSON.stringify(storedManifest, null, 2));
  return storedManifest;
}

export async function readPptNarrationAudioAsset(input: {
  manifestId: string;
  audioId: string;
  baseDir?: string;
}): Promise<PptNarrationAudioAssetRead> {
  const baseDir = resolveAudioAssetBaseDir(input.baseDir);
  const manifestId = requireSafeId(input.manifestId, "manifest id");
  const audioId = requireSafeId(input.audioId, "audio id");
  const filePath = resolve(baseDir, manifestId, `${audioId}.wav`);
  ensureWithinBase(baseDir, filePath);
  const bytes = await readFile(filePath);

  return {
    bytes,
    contentType: "audio/wav",
    filename: `${audioId}.wav`,
    byteLength: bytes.byteLength,
  };
}

function createPcm16MonoWav(pcmBytes: Buffer, sampleRateHz: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBytes.byteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBytes.byteLength, 40);
  return Buffer.concat([header, pcmBytes]);
}

function requireSafeId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function resolveAudioAssetBaseDir(baseDir?: string) {
  return baseDir ? resolve(baseDir) : DEFAULT_AUDIO_ASSET_DIR;
}

function ensureWithinBase(baseDir: string, targetPath: string) {
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}/`)) {
    throw new Error("Resolved audio asset path escapes the configured storage directory.");
  }
}

function createPptNarrationAudioRetentionPolicy(
  createdAt = new Date().toISOString(),
): PptNarrationAudioRetentionPolicy {
  return {
    classification: "course-ppt-narration-derived-audio",
    policy: "retain-derived-audio-for-365-days-or-owner-request",
    createdAt,
    deleteAfter: addDaysIso(createdAt, 365),
    deleteAfterDays: 365,
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
