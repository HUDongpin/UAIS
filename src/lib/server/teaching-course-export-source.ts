import { decodeDraftMedia, draftWavDuration } from "@/lib/teaching/unit-draft-media";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Locale } from "@/i18n/copy";
import { findPublishedPlaybackByCourseId } from "@/lib/learning/ppt-playback-catalog";
import { isTeachingUnitDraftContent } from "@/lib/teaching/unit-draft";
import { createUaisTeachingCourseManagementRepository } from "./teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
} from "./teaching-course-management-store";
import type { TeachingCourseExportSource } from "./teaching-course-export-package";

export class TeachingCourseExportSourceError extends Error {
  constructor(
    readonly status: number,
    readonly reasonCode: "export-content-unavailable" | "export-media-unavailable" | "export-too-large",
    message: string,
  ) {
    super(message);
    this.name = "TeachingCourseExportSourceError";
  }
}

const maxAssetBytes = 20 * 1024 * 1024;
const maxSourceBytes = 100 * 1024 * 1024;
const maxSlides = 250;

/** Reads actual, already registered course content after the route authorizes course.export. */
export async function readTeachingCourseExportSource(input: {
  courseId: string;
  locale: Locale;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  rootDir?: string;
}): Promise<TeachingCourseExportSource> {
  const env = input.env ?? process.env;
  const repository = createUaisTeachingCourseManagementRepository({ env, fetch: input.fetch });
  if (!repository) assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
  const { database } = await readTeachingCourseManagementSnapshot({
    dataDir: resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR),
    repository,
    courseId: input.courseId,
  });
  const agents = (database.agentSettings ?? [])
    .filter((settings) => settings.courseId === input.courseId)
    .map((settings) => ({
      scopes: [...settings.agentScopes],
      governancePolicy: settings.governancePolicy,
    }));
  // Managed course IDs also allow dots; published media IDs deliberately do not.
  const published = /^[A-Za-z0-9_-]+$/.test(input.courseId)
    ? findPublishedPlaybackByCourseId(input.courseId, env)
    : undefined;
  if (published) {
    if (published.slides.length > maxSlides) throw tooLarge();
    const localized = published.localized?.[input.locale];
    const assetRoot = resolve(input.rootDir ?? process.cwd(), "public/learning/ppt-playback");
    let sourceBytes = 0;
    const slides: TeachingCourseExportSource["slides"] = [];
    for (const slide of published.slides) {
      const copy = localized?.slides.find((entry) => entry.slideId === slide.slideId) ?? slide;
      const image = await readPublishedAsset(assetRoot, [
        "slides", requireAssetId(published.pptAssetId),
        `${requireAssetId(slide.slideId).replace(/^slide-/, "page-")}.jpg`,
      ], "jpg");
      const audio = await readPublishedAsset(assetRoot, [
        "audio", requireAssetId(published.audioManifestId), `${requireAssetId(slide.audioId)}.wav`,
      ], "wav");
      sourceBytes += image.byteLength + audio.byteLength;
      if (sourceBytes > maxSourceBytes) throw tooLarge();
      slides.push({
        id: slide.slideId,
        title: copy.slideTitle,
        notes: copy.narrationText,
        image: { bytes: image, extension: "jpg" },
        audio: { bytes: audio, extension: "wav" },
        durationSeconds: slide.durationSeconds,
      });
    }
    return {
      courseId: input.courseId,
      title: localized?.courseTitle ?? published.courseTitle,
      sourceKind: "published-playback",
      slides,
      agents,
    };
  }

  const draft = database.courseUnitDrafts?.find((entry) =>
    entry.courseId === input.courseId && isTeachingUnitDraftContent(entry.content),
  );
  if (!draft?.content) {
    throw new TeachingCourseExportSourceError(
      422, "export-content-unavailable",
      "This course has no published lesson or saved teaching draft to export.",
    );
  }
  const content = draft.content;
  const zh = input.locale === "zh-CN";
  const slides: TeachingCourseExportSource["slides"] = [
    { id: "draft-title", title: content.title, notes: content.lectureScript },
    { id: "draft-objectives", title: zh ? "学习目标" : "Learning objectives", notes: content.objectives.join("\n") },
    ...content.activities.map((activity, index) => ({
      id: `draft-activity-${index + 1}`, title: activity.title,
      notes: `${activity.durationMinutes} ${zh ? "分钟" : "minutes"}\n${activity.instructions}`,
    })),
    ...content.questions.map((question, index) => ({
      id: `draft-question-${index + 1}`, title: question.prompt,
      notes: question.referenceAnswer,
    })),
  ];
  for (const media of content.mediaSlides ?? []) {
    const audio = media.audio ? Buffer.from(decodeDraftMedia(media.audio)) : undefined;
    slides.push({
      id: `draft-media-${media.id}`, title: media.title, notes: media.notes,
      ...(media.image ? { image: { bytes: Buffer.from(decodeDraftMedia(media.image)), extension: media.image.mime === "image/png" ? "png" as const : "jpg" as const } } : {}),
      ...(audio ? { audio: { bytes: audio, extension: "wav" as const }, durationSeconds: draftWavDuration(audio) } : {}),
    });
  }
  return {
    courseId: input.courseId,
    title: content.title,
    sourceKind: "unit-draft",
    slides,
    unitDraft: {
      title: content.title, objectives: [...content.objectives],
      activities: content.activities.map(({ title, durationMinutes, instructions }) => ({ title, durationMinutes, instructions })),
      lectureScript: content.lectureScript,
      questions: content.questions.map(({ prompt, referenceAnswer }) => ({ prompt, referenceAnswer })),
    },
    agents,
  };
}

function requireAssetId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw mediaUnavailable();
  return value;
}

async function readPublishedAsset(baseDir: string, parts: string[], extension: "jpg" | "wav") {
  try {
    const base = await realpath(baseDir);
    const path = await realpath(join(base, ...parts));
    const child = relative(base, path);
    if (!child || child === ".." || child.startsWith(`..${sep}`) || child.startsWith(sep)) {
      throw mediaUnavailable();
    }
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) throw mediaUnavailable();
    if (info.size > maxAssetBytes) throw tooLarge();
    const bytes = await readFile(path);
    if (bytes.byteLength > maxAssetBytes) throw tooLarge();
    if (bytes.byteLength !== info.size) throw mediaUnavailable();
    if (extension === "jpg") {
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw mediaUnavailable();
      }
    } else if (
      bytes.length <= 44 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE"
    ) {
      throw mediaUnavailable();
    }
    return bytes;
  } catch (error) {
    if (error instanceof TeachingCourseExportSourceError) throw error;
    throw mediaUnavailable();
  }
}

function mediaUnavailable() {
  return new TeachingCourseExportSourceError(
    422, "export-media-unavailable",
    "A registered course media file is unavailable. Restore the source asset before exporting.",
  );
}

function tooLarge() {
  return new TeachingCourseExportSourceError(413, "export-too-large", "The course exceeds the export size limit.");
}
