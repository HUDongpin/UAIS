import type { Locale } from "@/i18n/copy";
import { getProviderForRole } from "@/lib/ai/providers/registry";

export type TeacherVoiceSampleSourceKind = "owner-provided" | "upload";
export type TeacherVoiceConsentScope = "ppt-narration";

export type TeacherVoiceSampleIntakeRequest = {
  teacherId: string;
  consentConfirmed: boolean;
  consentScope: TeacherVoiceConsentScope;
  sampleAssetId: string;
  sampleDurationSeconds: number;
  mimeType: string;
  sourceKind: TeacherVoiceSampleSourceKind;
  language?: Locale;
};

export type TeacherVoiceSampleIntake = {
  assetId: string;
  teacherId: string;
  providerRole: "voice-clone";
  provider: "qwen";
  status: "ready-for-clone";
  sampleDurationSeconds: number;
  consentScope: TeacherVoiceConsentScope;
  storagePolicy: "metadata-only";
};

export function createTeacherVoiceSampleIntake(
  request: TeacherVoiceSampleIntakeRequest,
): TeacherVoiceSampleIntake {
  if (!request.consentConfirmed) {
    throw new Error("Teacher consent is required before voice sample intake.");
  }

  if (request.consentScope !== "ppt-narration") {
    throw new Error("Teacher consent scope must allow PPT narration.");
  }

  if (!request.teacherId.trim()) {
    throw new Error("Teacher id is required for voice sample intake.");
  }

  if (!request.sampleAssetId.trim()) {
    throw new Error("Teacher voice sample asset is required.");
  }

  if (request.sampleDurationSeconds < 10) {
    throw new Error("Teacher voice sample must be at least 10 seconds long.");
  }

  if (!request.mimeType.startsWith("audio/")) {
    throw new Error("Teacher voice sample must be an audio asset.");
  }

  const provider = getProviderForRole("voice-clone");
  if (provider.provider !== "qwen") {
    throw new Error("Teacher voice sample intake must use the Qwen provider.");
  }

  return {
    assetId: request.sampleAssetId,
    teacherId: request.teacherId,
    providerRole: "voice-clone",
    provider: "qwen",
    status: "ready-for-clone",
    sampleDurationSeconds: request.sampleDurationSeconds,
    consentScope: request.consentScope,
    storagePolicy: "metadata-only",
  };
}
