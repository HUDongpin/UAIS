// AI-guide copy for the learner workspace: the three agent personas and the
// greeting / context hint / prompt chips that frame them. Pure functions, no JSX.
//
// Every string here is derived from the deck actually on the stage, the sample
// course the URL named, or nothing at all. It must never fall back to another
// course's lesson: this copy is what tells the learner which course they are
// talking to, and it feeds the prompts sent to /api/learning/ai-guide.

import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import type { Locale } from "@/i18n/copy";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import type { PlaybackContent } from "./learning-page-content";
import { getFallbackCourseTitle } from "./learning-page-helpers";

// The three guide personas. `slideTitle` is undefined when no lesson is on screen,
// and each prompt then asks about the course rather than naming a slide that does
// not exist. The ids and labels match the server personas in
// src/lib/ai/orchestration/learning-guide-graph.ts.
export function getAiGuideAgentCards(locale: Locale, slideTitle: string | undefined) {
  const zh = locale === "zh-CN";
  const about = slideTitle
    ? zh
      ? `「${slideTitle}」`
      : `"${slideTitle}"`
    : zh
      ? "本课程"
      : "this course";

  return [
    {
      id: "learning-advisor" as const,
      label: zh ? "学习顾问" : "Study Advisor",
      sub: zh ? "学习路径规划" : "Path planning",
      icon: BookOpen,
      prompt: zh
        ? `请基于${about}给我一个 10 分钟学习路径`
        : `Give me a 10-minute study path for ${about}`,
    },
    {
      id: "concept-explainer" as const,
      label: zh ? "概念解读" : "Concepts",
      sub: zh ? "知识点解析" : "Explain ideas",
      icon: Sparkle,
      prompt: zh
        ? `解释${about}的核心概念、常见误区和例子`
        : `Explain the core idea, misconception, and example for ${about}`,
    },
    {
      // Was "Teaching TA", with a prompt asking for a classroom question and a
      // teaching example. Both the zh-CN card and the server persona call this
      // agent the Code Assistant, so an English-locale student picked a card
      // promising teaching examples and got steps and pseudocode back.
      id: "code-assistant" as const,
      label: zh ? "代码助手" : "Code Assistant",
      sub: zh ? "算法与实现" : "Algorithms and code",
      icon: GearSix,
      prompt: zh
        ? `把${about}转成步骤、伪代码或短代码示例`
        : `Turn ${about} into steps, pseudocode, or a short code example`,
    },
  ];
}

export function getAiGuideCopy(
  locale: Locale,
  playback: PlaybackContent | undefined,
  publishedPlayback?: LearningPptPlaybackManifest,
  activePublishedSlide?: LearningPptPlaybackSlide,
  courseTitleFallback?: string,
) {
  const zh = locale === "zh-CN";
  const courseTitle =
    publishedPlayback?.courseTitle ??
    getFallbackCourseTitle(playback, locale) ??
    courseTitleFallback;
  const slideTitle = activePublishedSlide?.slideTitle ?? playback?.slideTitle;
  // No slide on screen and no sample behind it: the guide introduces itself
  // without describing a lesson, rather than quoting the demo deck's slide 3 and
  // offering three prompts about it.
  if (!slideTitle) {
    return {
      greeting: courseTitle
        ? zh
          ? `你好！我是《${courseTitle}》智能导学。本课程还没有已发布的课件，你仍然可以直接提问。`
          : `Hi, I am the AI guide for ${courseTitle}. This course has no published lesson yet, and you can still ask a question.`
        : zh
          ? "你好！我是智能导学。课程课件加载后，我会围绕当前页帮你总结和答疑。"
          : "Hi, I am the AI guide. Once this course's lesson loads I will summarize and answer questions about the current slide.",
      contextHint: zh
        ? "暂无讲解线索：本课程尚未发布课件。"
        : "No narration cue yet: this course has no published lesson.",
      prompts: [] as string[],
      agentCards: getAiGuideAgentCards(locale, undefined),
      multiAgentLabel: zh ? "LangGraph 多智能体导学" : "LangGraph multi-agent guide",
    };
  }
  const slidePosition = activePublishedSlide
    ? locale === "zh-CN"
      ? `第 ${activePublishedSlide.slideNumber} 页`
      : `slide ${activePublishedSlide.slideNumber}`
    : playback!.slideLabel;
  const guideContext =
    activePublishedSlide?.narrationText ??
    playback?.subtitles.find((subtitle) => subtitle.active)?.text ??
    playback?.aiMessages[0]?.body;

  if (locale === "zh-CN") {
    return {
      greeting: `你好！我是《${courseTitle}》智能导学，会围绕当前${slidePosition}「${slideTitle}」帮你总结、答疑和拓展学习。`,
      contextHint: `当前讲解线索：${guideContext}`,
      prompts: [
        `解释「${slideTitle}」的核心概念`,
        "把这页整理成 3 个学习要点",
        `根据「${slideTitle}」生成一个课堂提问`,
      ],
      agentCards: getAiGuideAgentCards(locale, slideTitle),
      multiAgentLabel: "LangGraph 多智能体导学",
      buildReceipt: (question: string) =>
        `智能导学已收到，会结合《${courseTitle}》当前${slidePosition}「${slideTitle}」、字幕和课程目录帮你拆解这个问题：${question}`,
      buildMultiAgentReceipt: (question: string) =>
        `智能导学已收到，多智能体链路会让学习顾问、概念解读和代码助手共同处理：${question}`,
    };
  }

  return {
    greeting: `Hi, I am the AI guide for ${courseTitle}. I will use the current ${slidePosition}, "${slideTitle}", to summarize, answer questions, and extend your learning.`,
    contextHint: `Current narration cue: ${guideContext}`,
    prompts: [
      `Explain the core idea of "${slideTitle}"`,
      "Turn this slide into 3 study takeaways",
      `Create a classroom question for "${slideTitle}"`,
    ],
    agentCards: getAiGuideAgentCards(locale, slideTitle),
    multiAgentLabel: "LangGraph multi-agent guide",
    buildReceipt: (question: string) =>
      `AI Guide received: ${question}. I will connect ${courseTitle}, the current ${slidePosition} "${slideTitle}", subtitles, and outline for you.`,
    buildMultiAgentReceipt: (question: string) =>
      `The multi-agent chain received: ${question}. Study Advisor, Concept Explainer, and Code Assistant will work together.`,
  };
}
