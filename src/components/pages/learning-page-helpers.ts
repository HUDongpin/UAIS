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

// Course-neutral on purpose. These three labels are rendered on every course's
// playback stage, and they used to name the mathematics deck - "此数学课件" /
// "the mathematics PPT" - to a student whose deck refusal had nothing to do with
// mathematics. The failure is about *this* course's slides, whichever course the
// learner opened.
export function getPublishedPlaybackErrorLabel(
  locale: Locale,
  error: PublishedPlaybackError,
) {
  if (error === "auth-required") {
    return locale === "zh-CN"
      ? "请重新登录后访问课程课件"
      : "Sign in again to access the course slides";
  }
  if (error === "access-denied") {
    return locale === "zh-CN"
      ? "当前账号无权访问此课程课件"
      : "This account cannot access the course slides";
  }
  return locale === "zh-CN"
    ? "课程课件资源暂时不可用"
    : "The course slides are temporarily unavailable";
}

// Per-learner, per-course, per-manifest narration completion, persisted by the
// playback surface so finishing a deck across several visits still adds up.
// Exported so the outline can report the learner's *real* progress from the same
// key the narration dock writes, instead of inventing one.
export function createCompletedNarrationStorageKey({
  learnerAccount,
  courseId,
  audioManifestId,
}: {
  learnerAccount: string;
  courseId: string;
  audioManifestId: string;
}) {
  return ["uais-completed-narration", learnerAccount, courseId, audioManifestId].join(":");
}

export function readCompletedNarrationSlideIds(storageKey: string): Set<string> {
  const completedSlideIds = new Set<string>();
  if (typeof window === "undefined") {
    return completedSlideIds;
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
    if (Array.isArray(stored)) {
      for (const value of stored) {
        if (typeof value === "string") {
          completedSlideIds.add(value);
        }
      }
    }
  } catch {
    // Storage unavailable or corrupted: an empty set is the honest answer.
  }

  return completedSlideIds;
}

// `durationSeconds` is real manifest data, so the outline can show a real slide
// length instead of the sample syllabus's placeholder timings.
export function formatSlideDurationLabel(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "--:--";
  }
  const totalSeconds = Math.round(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// The honest empty state that replaced a fabricated lecture.
//
// When no deck loaded, the stage used to render a complete, invented machine-
// learning lesson - "3.2 梯度下降算法", a goal, an update rule, a θ/η/∇J bullet
// list, a diagram and a "30 / 68" slide counter - to a student enrolled in a
// mathematics-education course. It was indistinguishable from real content, and
// the first thing a student would do with it is screenshot it.
//
// These two say what is actually true: either the deck could not be loaded (the
// error label above says why), or this course has no published lesson yet.
export function getPublishedPlaybackEmptyTitle(locale: Locale) {
  return locale === "zh-CN" ? "本课程暂无已发布课件" : "No published lesson yet";
}

export function getPublishedPlaybackEmptyDescription(locale: Locale) {
  return locale === "zh-CN"
    ? "教师发布课件后，这里会显示本节课的幻灯片与讲解音频。"
    : "Once your teacher publishes a deck, its slides and narration appear here.";
}

// The course a learning record may name, or `undefined` when there is none.
//
// The study-tool, AI-guide and checkpoint events used to fall back to
// `selectedCourseId`, which on a bare `/learning` is the template's demo course
// (`research-methods-learning` - see `fallbackCourseId`). A real student who had
// never joined that course therefore had their notes exports, guide questions and
// checkpoint attempts written to the LRS stamped with a demo course id, polluting
// their own learning record and that course's analytics with activity that never
// happened there.
//
// `LearningRecordEventInput["context"].courseId` is a required string, so there is
// no null-course statement to fall back to: the xAPI statement builder always
// creates a course activity from it (`createCourseActivityId`). The event is
// therefore suppressed instead. That also matches the server, which authorizes
// every event against course membership and answers 403
// (`learner-course-membership-required`) for exactly this case - so the suppressed
// calls were never going to be recorded anyway, only retried.
//
// A published deck is proof enough on its own: the playback route only serves one
// to a learner the course actually admits. Without a deck, an approved invite
// membership for the very course on screen is the other legitimate attribution.
export function resolveLearningEventCourseId(input: {
  publishedPlaybackCourseId?: string;
  selectedCourseId: string;
  approvedMembershipCourseId?: string;
}): string | undefined {
  if (input.publishedPlaybackCourseId) {
    return input.publishedPlaybackCourseId;
  }
  return input.approvedMembershipCourseId === input.selectedCourseId
    ? input.selectedCourseId
    : undefined;
}

export type StudyAction = "ask" | "notes" | "checkpoint" | "concepts" | "export";

export type StudyToolView = "notes" | "checkpoint" | "concepts";
