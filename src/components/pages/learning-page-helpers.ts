// Slide-study, playback-content, and notes-export helpers for the learner workspace
// (Phase 3 decomposition of learning-page.tsx). Pure functions — no JSX, hooks, or
// chatroom coupling — shared by the playback/study surfaces.



import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import type { Locale } from "@/i18n/copy";
import {
  fallbackCourseId,
  playbackByCourseId,
  type PlaybackContent,
} from "./learning-page-content";

export type SlideStudyContent = {
  courseTitle: string;
  slideLabel: string;
  slideTitle: string;
  narrationCue: string;
  takeaways: string[];
  concepts: {
    title: string;
    description: string;
  }[];
  checkpoints: {
    id: string;
    question: string;
    answer: string;
  }[];
};

export function getPlaybackContent(courseId: string, locale: Locale) {
  return (
    playbackByCourseId[courseId]?.[locale] ??
    playbackByCourseId[fallbackCourseId][locale]
  );
}

export function getFallbackCourseTitle(playback: PlaybackContent, locale: Locale) {
  return playback.liveHint.replace(
    locale === "zh-CN" ? "当前课程：" : "Current course: ",
    "",
  );
}

export function createSlideStudyContent({
  locale,
  playback,
  publishedPlayback,
  activePublishedSlide,
}: {
  locale: Locale;
  playback: PlaybackContent;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
}): SlideStudyContent {
  const zh = locale === "zh-CN";
  const courseTitle = publishedPlayback?.courseTitle ?? getFallbackCourseTitle(playback, locale);
  const slideTitle = activePublishedSlide?.slideTitle ?? playback.slideTitle;
  const slideLabel = activePublishedSlide
    ? zh
      ? `第 ${activePublishedSlide.slideNumber} 页`
      : `Slide ${activePublishedSlide.slideNumber}`
    : playback.slideLabel;
  const narrationCue =
    activePublishedSlide?.narrationText ??
    playback.subtitles.find((subtitle) => subtitle.active)?.text ??
    playback.slideSubtitle;
  const takeaways = activePublishedSlide
    ? [
        zh ? `围绕「${slideTitle}」先复述本页主张。` : `Restate the main claim of "${slideTitle}".`,
        zh ? `用讲解线索核对关键词和例子。` : "Use the narration cue to check keywords and examples.",
        zh ? "把本页内容转成一个可向同伴解释的问题。" : "Turn the slide into one peer-explainable question.",
      ]
    : playback.slidePoints;
  const concepts = activePublishedSlide
    ? [
        {
          title: slideTitle,
          description: zh
            ? `本页核心标题，需要能用自己的话解释。`
            : "The slide's main title, which should be explained in your own words.",
        },
        {
          title: zh ? "讲解线索" : "Narration cue",
          description: narrationCue,
        },
        {
          title: zh ? "课堂转化" : "Classroom transfer",
          description: zh
            ? "把 PPT 讲解转成提问、例子或小组讨论任务。"
            : "Turn the slide narration into a question, example, or group task.",
        },
      ]
    : playback.conceptPins.map((concept, index) => ({
        title: concept,
        description:
          playback.slidePoints[index] ??
          (zh ? "请用本页讲解线索补充解释。" : "Use the current narration cue to explain it."),
      }));

  return {
    courseTitle,
    slideLabel,
    slideTitle,
    narrationCue,
    takeaways,
    concepts,
    checkpoints: [
      {
        id: "core",
        question: zh ? `检查点 1：本页最核心的问题是什么？` : "Checkpoint 1: What is the core question?",
        answer: zh
          ? `围绕「${slideTitle}」，先说清它和《${courseTitle}》当前学习任务的关系。`
          : `Start with how "${slideTitle}" connects to the current learning task in ${courseTitle}.`,
      },
      {
        id: "evidence",
        question: zh ? "检查点 2：你能指出一个证据或例子吗？" : "Checkpoint 2: Can you name one evidence cue or example?",
        answer: narrationCue,
      },
      {
        id: "transfer",
        question: zh ? "检查点 3：你会怎样向小组解释？" : "Checkpoint 3: How would you explain this to your group?",
        answer: takeaways[0] ?? (zh ? "先复述标题，再补充一个例子。" : "Restate the title, then add one example."),
      },
    ],
  };
}

export function createAskThisSlidePrompt(content: SlideStudyContent, locale: Locale) {
  return locale === "zh-CN"
    ? `请解释当前页「${content.slideTitle}」的核心概念、讲解线索和一个例子。`
    : `Please explain the core idea, narration cue, and one example for the current slide, "${content.slideTitle}".`;
}

export function createStudyNotesMarkdown(content: SlideStudyContent, locale: Locale) {
  if (locale === "zh-CN") {
    return [
      `# ${content.slideTitle}`,
      "",
      `- 课程：${content.courseTitle}`,
      `- 位置：${content.slideLabel}`,
      `- 讲解线索：${content.narrationCue}`,
      "",
      "## 学习要点",
      ...content.takeaways.map((takeaway) => `- ${takeaway}`),
      "",
      "## 关键概念",
      ...content.concepts.map((concept) => `- ${concept.title}：${concept.description}`),
      "",
    ].join("\n");
  }

  return [
    `# ${content.slideTitle}`,
    "",
    `- Course: ${content.courseTitle}`,
    `- Position: ${content.slideLabel}`,
    `- Narration cue: ${content.narrationCue}`,
    "",
    "## Study Takeaways",
    ...content.takeaways.map((takeaway) => `- ${takeaway}`),
    "",
    "## Key Concepts",
    ...content.concepts.map((concept) => `- ${concept.title}: ${concept.description}`),
    "",
  ].join("\n");
}

export function createSafeDownloadFileName(title: string) {
  const normalizedTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${normalizedTitle || "uais-slide-notes"}.md`;
}

export function exportSlideStudyNotes(content: SlideStudyContent, locale: Locale) {
  const markdown = createStudyNotesMarkdown(content, locale);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const objectUrl =
    typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(blob)
      : `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = createSafeDownloadFileName(content.slideTitle);
  document.body.append(link);
  link.click();
  link.remove();

  if (objectUrl.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(objectUrl);
  }
}

export type PublishedPlaybackError = "auth-required" | "access-denied" | "unavailable";

export function getPublishedPlaybackError(status: number): PublishedPlaybackError {
  if (status === 401) {
    return "auth-required";
  }
  if (status === 403) {
    return "access-denied";
  }
  return "unavailable";
}

export function getPublishedPlaybackErrorLabel(
  locale: Locale,
  error: PublishedPlaybackError,
) {
  if (error === "auth-required") {
    return locale === "zh-CN"
      ? "请重新登录后访问数学课件"
      : "Sign in again to access the mathematics PPT";
  }
  if (error === "access-denied") {
    return locale === "zh-CN"
      ? "当前账号无权访问此数学课件"
      : "This account cannot access the mathematics PPT";
  }
  return locale === "zh-CN"
    ? "数学课件资源暂时不可用"
    : "Mathematics PPT resources are temporarily unavailable";
}

export type StudyAction = "ask" | "notes" | "checkpoint" | "concepts" | "export";

export type StudyToolView = "notes" | "checkpoint" | "concepts";
