import type { StoredPptNarrationAudioManifest } from "@/lib/ai/voice/ppt-narration-assets";
import { defaultLocale, type Locale } from "@/i18n/copy";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import {
  findPublishedPlaybackByCourseId,
  type PublishedPptPlayback,
} from "@/lib/learning/ppt-playback-catalog";
// Shared with the publish script, so the duration a deck is published with and
// the duration this builds from the same WAV cannot drift apart.
import { durationSecondsFromPcmWavBytes } from "@/lib/learning/published-deck-validation.mjs";

export function createLearningPptPlaybackManifestForCourse(input: {
  courseId: string;
  storedManifest: StoredPptNarrationAudioManifest;
  locale?: Locale;
}): LearningPptPlaybackManifest | undefined {
  const published = findPublishedPlaybackByCourseId(input.courseId);
  if (!published) {
    return undefined;
  }
  return createLearningPptPlaybackManifest({
    published,
    storedManifest: input.storedManifest,
    locale: input.locale,
  });
}

export function createPublishedLearningPptPlaybackManifestForCourse(
  courseId: string,
  locale: Locale = defaultLocale,
): LearningPptPlaybackManifest | undefined {
  const published = findPublishedPlaybackByCourseId(courseId);
  if (!published) {
    return undefined;
  }
  return createPublishedLearningPptPlaybackManifest(published, locale);
}

export function createLearningPptPlaybackManifest(input: {
  published: PublishedPptPlayback;
  storedManifest: StoredPptNarrationAudioManifest;
  locale?: Locale;
}): LearningPptPlaybackManifest {
  const { published, storedManifest } = input;
  const publishedCopy = getPublishedPlaybackCopy(published, input.locale ?? defaultLocale);
  if (storedManifest.id !== published.audioManifestId) {
    throw new Error("Published playback manifest id does not match stored audio manifest.");
  }
  if (storedManifest.courseId !== published.courseId) {
    throw new Error("Published playback course id does not match stored audio manifest.");
  }
  if (storedManifest.pptAssetId !== published.pptAssetId) {
    throw new Error("Published playback PPT id does not match stored audio manifest.");
  }

  const slides = storedManifest.assets.map<LearningPptPlaybackSlide>((asset, index) => {
    const slideCopy = publishedCopy.slides.find((slide) => slide.slideId === asset.slideId);
    return {
      slideId: asset.slideId,
      slideNumber: index + 1,
      slideTitle: slideCopy?.slideTitle ?? `Slide ${index + 1}`,
      narrationText: slideCopy?.narrationText ?? "",
      imageUrl: buildLearningSlideImageUrl(published.pptAssetId, asset.slideId),
      audioId: asset.audioId,
      audioUrl: buildLearningAudioUrl(storedManifest.id, asset.audioId),
      durationSeconds: durationSecondsFromPcmWavBytes(asset.byteLength, asset.sampleRateHz),
    };
  });

  const playback: LearningPptPlaybackManifest = {
    status: "ready",
    courseId: published.courseId,
    courseTitle: publishedCopy.courseTitle,
    sourceDeckTitle: publishedCopy.sourceDeckTitle,
    audioManifestId: storedManifest.id,
    teacherName: publishedCopy.teacherName,
    voiceLabel: publishedCopy.voiceLabel,
    slideCount: slides.length,
    slides,
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "published-learning-ids-only",
    },
  };
  assertLearningPlaybackIsDisplaySafe(playback);
  return playback;
}

function createPublishedLearningPptPlaybackManifest(
  published: PublishedPptPlayback,
  locale: Locale,
): LearningPptPlaybackManifest {
  const publishedCopy = getPublishedPlaybackCopy(published, locale);
  const slides = publishedCopy.slides.map<LearningPptPlaybackSlide>((slide, index) => ({
    slideId: slide.slideId,
    slideNumber: index + 1,
    slideTitle: slide.slideTitle,
    narrationText: slide.narrationText,
    imageUrl: buildLearningSlideImageUrl(published.pptAssetId, slide.slideId),
    audioId: slide.audioId,
    audioUrl: buildLearningAudioUrl(published.audioManifestId, slide.audioId),
    durationSeconds: slide.durationSeconds,
  }));

  const playback: LearningPptPlaybackManifest = {
    status: "ready",
    courseId: published.courseId,
    courseTitle: publishedCopy.courseTitle,
    sourceDeckTitle: publishedCopy.sourceDeckTitle,
    audioManifestId: published.audioManifestId,
    teacherName: publishedCopy.teacherName,
    voiceLabel: publishedCopy.voiceLabel,
    slideCount: slides.length,
    slides,
    redaction: {
      secrets: "omitted",
      localFiles: "omitted",
      assets: "published-learning-ids-only",
    },
  };
  assertLearningPlaybackIsDisplaySafe(playback);
  return playback;
}

function getPublishedPlaybackCopy(published: PublishedPptPlayback, locale: Locale) {
  const localized = published.localized?.[locale];
  if (!localized) {
    return {
      courseTitle: published.courseTitle,
      sourceDeckTitle: published.sourceDeckTitle,
      teacherName: published.teacherName,
      voiceLabel: published.voiceLabel,
      slides: published.slides.map((slide) => ({
        slideId: slide.slideId,
        slideTitle: slide.slideTitle,
        narrationText: slide.narrationText,
        audioId: slide.audioId,
        durationSeconds: slide.durationSeconds,
      })),
    };
  }

  return {
    courseTitle: localized.courseTitle,
    sourceDeckTitle: localized.sourceDeckTitle,
    teacherName: localized.teacherName,
    voiceLabel: localized.voiceLabel,
    slides: published.slides.map((slide) => {
      const localizedSlide = localized.slides.find((copy) => copy.slideId === slide.slideId);
      return {
        slideId: slide.slideId,
        slideTitle: localizedSlide?.slideTitle ?? slide.slideTitle,
        narrationText: localizedSlide?.narrationText ?? slide.narrationText,
        audioId: slide.audioId,
        durationSeconds: slide.durationSeconds,
      };
    }),
  };
}

function buildLearningAudioUrl(manifestId: string, audioId: string) {
  return `/api/learning/ppt-playback/audio/${manifestId}/${audioId}`;
}

function buildLearningSlideImageUrl(pptAssetId: string, slideId: string) {
  const pageId = slideId.replace(/^slide-/, "page-");
  return `/learning/ppt-playback/slides/${pptAssetId}/${pageId}.jpg`;
}

function assertLearningPlaybackIsDisplaySafe(value: LearningPptPlaybackManifest) {
  const serialized = JSON.stringify(value);
  if (UNSAFE_PLAYBACK_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("Learning PPT playback manifest contains non-display-safe data.");
  }
}

const UNSAFE_PLAYBACK_PATTERNS = [
  /\/api\/ai\/ppt-narration\/audio/,
  /server-side-cloned-qwen-voice/,
  /DASHSCOPE_API_KEY/,
  /DEEPSEEK_API_KEY/,
  /UAIS_LIVE_AI_APPROVAL_TOKEN/,
  /\/Users\//,
  /data:audio\/[^"',}\]\s]+base64/i,
  // Match the serialized field name (`"audioBase64":`), not a prose mention in
  // curated slide narration.
  /"audioBase64"/i,
];
