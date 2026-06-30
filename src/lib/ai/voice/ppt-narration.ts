import type { Locale } from "@/i18n/copy";
import { getProviderForRole } from "@/lib/ai/providers/registry";
export { QWEN_REALTIME_VOICE_CLONE_MODEL } from "@/lib/ai/providers/qwen-models";
import { QWEN_REALTIME_VOICE_CLONE_MODEL } from "@/lib/ai/providers/qwen-models";

export type TeacherVoiceCloneRequest = {
  teacherId: string;
  consentConfirmed: boolean;
  sampleAssetId: string;
  sampleDurationSeconds: number;
  language: Locale;
  targetVoiceLabel: string;
};

export type TeacherVoiceCloneJob = {
  id: string;
  provider: "qwen";
  providerRole: "voice-clone";
  status: "queued";
  teacherId: string;
  sampleAssetId: string;
  sampleDurationSeconds: number;
  language: Locale;
  targetVoiceLabel: string;
};

export type PptNarrationSlideScript = {
  slideId: string;
  narrationText: string;
};

export type PptNarrationRequest = {
  courseId: string;
  pptAssetId: string;
  clonedVoiceId: string;
  language: Locale;
  slideScripts: PptNarrationSlideScript[];
  targetModel?: string;
};

export type PptNarrationJob = {
  id: string;
  provider: "qwen";
  providerRole: "ppt-narration";
  status: "queued";
  courseId: string;
  pptAssetId: string;
  clonedVoiceId: string;
  language: Locale;
  slideCount: number;
  audioManifestId: string;
  targetModel: string;
};

export type PptNarrationAudioSegment = {
  id: string;
  slideId: string;
  audioId: string;
  narrationText: string;
  format: "pcm";
  sampleRateHz: 24000;
  status: "queued";
  responsibleSession: "S07/S12/S24";
};

export type PptNarrationAudioManifest = {
  id: string;
  provider: "qwen";
  providerRole: "ppt-narration";
  targetModel: string;
  voiceRef: "server-side-cloned-qwen-voice";
  courseId: string;
  pptAssetId: string;
  language: Locale;
  sourcePattern: "openmaic-register-once-speech-action-tts";
  segments: PptNarrationAudioSegment[];
};

export function createTeacherVoiceCloneJob(
  request: TeacherVoiceCloneRequest,
): TeacherVoiceCloneJob {
  if (!request.consentConfirmed) {
    throw new Error("Teacher consent is required before voice cloning.");
  }

  if (request.sampleDurationSeconds < 10) {
    throw new Error("Teacher voice sample must be at least 10 seconds long.");
  }

  if (!request.sampleAssetId.trim()) {
    throw new Error("Teacher voice sample asset is required.");
  }

  const provider = getProviderForRole("voice-clone");
  if (provider.provider !== "qwen") {
    throw new Error("Voice cloning must use the Qwen provider role.");
  }

  return {
    id: buildStableJobId("voice-clone", request.teacherId, request.sampleAssetId),
    provider: "qwen",
    providerRole: "voice-clone",
    status: "queued",
    teacherId: request.teacherId,
    sampleAssetId: request.sampleAssetId,
    sampleDurationSeconds: request.sampleDurationSeconds,
    language: request.language,
    targetVoiceLabel: request.targetVoiceLabel,
  };
}

export function createPptNarrationJob(request: PptNarrationRequest): PptNarrationJob {
  if (!request.clonedVoiceId.trim()) {
    throw new Error("A cloned voice id is required for PPT narration.");
  }

  if (request.slideScripts.length === 0) {
    throw new Error("At least one slide narration script is required.");
  }

  if (request.slideScripts.some((script) => !script.slideId.trim() || !script.narrationText.trim())) {
    throw new Error("Every slide script must include a slide id and narration text.");
  }

  const provider = getProviderForRole("ppt-narration");
  if (provider.provider !== "qwen") {
    throw new Error("PPT narration must use the Qwen provider role.");
  }

  return {
    id: buildStableJobId("ppt-narration", request.courseId, request.pptAssetId),
    provider: "qwen",
    providerRole: "ppt-narration",
    status: "queued",
    courseId: request.courseId,
    pptAssetId: request.pptAssetId,
    clonedVoiceId: request.clonedVoiceId,
    language: request.language,
    slideCount: request.slideScripts.length,
    audioManifestId: buildStableJobId("audio-manifest", request.courseId, request.pptAssetId),
    targetModel: request.targetModel ?? QWEN_REALTIME_VOICE_CLONE_MODEL,
  };
}

export function createPptNarrationAudioManifest(
  request: PptNarrationRequest,
): PptNarrationAudioManifest {
  const job = createPptNarrationJob(request);

  return {
    id: job.audioManifestId,
    provider: "qwen",
    providerRole: "ppt-narration",
    targetModel: job.targetModel,
    voiceRef: "server-side-cloned-qwen-voice",
    courseId: request.courseId,
    pptAssetId: request.pptAssetId,
    language: request.language,
    sourcePattern: "openmaic-register-once-speech-action-tts",
    segments: request.slideScripts.map((script) => {
      const slideId = normalizeIdPart(script.slideId);
      return {
        id: `tts-${slideId}`,
        slideId: script.slideId,
        audioId: `tts_${normalizeIdPart(request.pptAssetId)}_${slideId}`,
        narrationText: script.narrationText,
        format: "pcm",
        sampleRateHz: 24000,
        status: "queued",
        responsibleSession: "S07/S12/S24",
      };
    }),
  };
}

function buildStableJobId(prefix: string, ...parts: string[]) {
  return [prefix, ...parts.map(normalizeIdPart)]
    .filter(Boolean)
    .join("-");
}

function normalizeIdPart(part: string) {
  return part.trim().replace(/[^a-zA-Z0-9-]+/g, "-");
}
