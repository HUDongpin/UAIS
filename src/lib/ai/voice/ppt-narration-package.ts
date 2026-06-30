import type { Locale } from "@/i18n/copy";
import type { PptNarrationSlideScript, TeacherVoiceCloneRequest } from "@/lib/ai/voice/ppt-narration";

export type PptNarrationScriptPackage = {
  packageId: string;
  sourceDeckTitle: string;
  courseId: string;
  pptAssetId: string;
  expectedSlideCount: number;
  language: Locale;
  teacherVoice: {
    teacherId: string;
    sampleAssetId: string;
    sampleDurationSeconds: number;
    targetVoiceLabel: string;
    voiceRefId: string;
    voiceRef: "server-side-cloned-qwen-voice";
  };
  slideScripts: PptNarrationSlideScript[];
  responsibleSessions: Array<"S07" | "S12" | "S24">;
};

export type PptNarrationRoutePayloadFromScriptPackage = {
  voiceClone: TeacherVoiceCloneRequest;
  pptNarration: {
    courseId: string;
    pptAssetId: string;
    clonedVoiceRef: string;
    language: Locale;
    slideScripts: PptNarrationSlideScript[];
  };
};

export function assertPptNarrationScriptPackageIsDisplaySafe(
  scriptPackage: PptNarrationScriptPackage,
) {
  const serialized = JSON.stringify(scriptPackage);
  if (unsafeDisplayPatterns.some((pattern) => pattern.test(serialized))) {
    throw new Error("PPT narration script package contains non-display-safe data.");
  }

  return scriptPackage;
}

export function createPptNarrationRoutePayloadFromScriptPackage(
  scriptPackage: PptNarrationScriptPackage,
): PptNarrationRoutePayloadFromScriptPackage {
  assertPptNarrationScriptPackageIsDisplaySafe(scriptPackage);
  if (scriptPackage.slideScripts.length !== scriptPackage.expectedSlideCount) {
    throw new Error("PPT narration script package slide count does not match.");
  }

  if (scriptPackage.slideScripts.some((script) => !script.slideId.trim() || !script.narrationText.trim())) {
    throw new Error("Every PPT narration script requires a slide id and narration text.");
  }

  return {
    voiceClone: {
      teacherId: scriptPackage.teacherVoice.teacherId,
      consentConfirmed: true,
      sampleAssetId: scriptPackage.teacherVoice.sampleAssetId,
      sampleDurationSeconds: scriptPackage.teacherVoice.sampleDurationSeconds,
      language: scriptPackage.language,
      targetVoiceLabel: scriptPackage.teacherVoice.targetVoiceLabel,
    },
    pptNarration: {
      courseId: scriptPackage.courseId,
      pptAssetId: scriptPackage.pptAssetId,
      clonedVoiceRef: scriptPackage.teacherVoice.voiceRefId,
      language: scriptPackage.language,
      slideScripts: scriptPackage.slideScripts,
    },
  };
}

const unsafeDisplayPatterns = [
  /\/Users\//,
  /data:audio\/[^"\\\s]+;base64/i,
  /voice-qwen-private/i,
  /(?:API_KEY|TOKEN|SECRET)=/i,
  /sk-[A-Za-z0-9]/,
];
