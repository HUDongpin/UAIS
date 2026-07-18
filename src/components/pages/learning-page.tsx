"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { ChatsCircle } from "@phosphor-icons/react/dist/ssr/ChatsCircle";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { LinkSimple } from "@phosphor-icons/react/dist/ssr/LinkSimple";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { PlayCircle } from "@phosphor-icons/react/dist/ssr/PlayCircle";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Target } from "@phosphor-icons/react/dist/ssr/Target";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { localizedText } from "@/components/ui/localized-text";
import {
  aiAgents,
  chatMessages,
  type ChatMessage,
} from "@/data/uais";
import { copy, type Locale } from "@/i18n/copy";
import { createShareLink, exportChatToPdf } from "@/lib/chat-actions";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import {
  fallbackCourseId,
  courseDirectoryChapters,
  courseDirectoryLessonTimes,
  playbackByCourseId,
  publishedLearningPptCourseId,
  type PlaybackContent,
} from "./learning-page-content";
import {
  createAskThisSlidePrompt,
  createSlideStudyContent,
  exportSlideStudyNotes,
  getPlaybackContent,
  getPublishedPlaybackError,
  type SlideStudyContent,
  type PublishedPlaybackError,
  type StudyAction,
  type StudyToolView,
} from "./learning-page-helpers";
import { PptStage, SlideChapterRail } from "./learning-page-slides";
import { NarrationDock } from "./learning-page-narration";
import { StudyToolsPanel } from "./learning-page-study-tools";
import { LangGraphTracePanel } from "./learning-page-trace-panel";


type PrimaryCompanionView = "ai" | "subtitles" | "outline";


type CompanionView = PrimaryCompanionView | StudyToolView;


type AiGuideMessage = {
  id: string;
  kind: "user" | "assistant";
  text: string;
  orchestration?: LearningAiGuideOrchestration;
  hitl?: AiGuideHumanReviewState;
};

type LearningAiGuideAgentId = "learning-advisor" | "concept-explainer" | "code-assistant";

type LearningAiGuideApiResponse = {
  message?: {
    text?: string;
  };
  provider?: {
    provider?: "deepseek" | "qwen" | "langgraph";
    role?: "text-reasoning" | "multimodal" | "multi-agent";
    model?: string;
  };
  orchestration?: LearningAiGuideOrchestration;
  error?: string;
};

export type AiGuideHumanReviewState = {
  status: "ready" | "waiting-human" | "resumed" | "failed";
  busy?: boolean;
  text?: string;
  prompt?: string;
  decision?: string;
};

type LearningAiGuideHitlApiResponse = {
  status?: "interrupted" | "completed";
  message?: {
    text?: string;
  };
  humanInTheLoop?: {
    status?: "waiting-human" | "resumed";
    threadId?: string;
    decision?: string;
    interrupt?: {
      value?: {
        prompt?: string;
      };
    };
  };
  error?: string;
};

export type LearningAiGuideOrchestration = {
  graph?: {
    runtime?: "langgraph";
    graphId?: string;
    supervisorNodeId?: string;
    topologicalOrder?: string[];
  };
  turns?: Array<{
    agentId?: string;
    label?: string;
    providerRole?: string;
    content?: string;
  }>;
  trace?: {
    handoffs?: Array<{
      fromNodeId?: string;
      toNodeId?: string;
      reason?: string;
    }>;
    memory?: {
      mode?: string;
      threadId?: string;
      store?: string;
    };
    humanInTheLoop?: {
      status?: string;
      resumeMode?: string;
    };
  };
  runtime?: {
    engine?: string;
    status?: string;
    threadId?: string;
    eventCount?: number;
  };
  runtimeEvents?: Array<{
    type?: string;
    nodeId?: string;
  }>;
};

function getSelectedStudyToolView(view: CompanionView): StudyToolView {
  if (view === "checkpoint" || view === "concepts" || view === "notes") {
    return view;
  }

  return "notes";
}

type LearningPageProps = {
  initialCourseId?: string;
  initialClassId?: string;
};

type ApprovedInviteLearningContext = {
  courseId: string;
  classId: string;
  courseName: string;
  className: string;
  semester?: string;
};

type TeachingCoursesResponseCourse = {
  courseId?: unknown;
  courseName?: unknown;
  semester?: unknown;
};

type TeachingCoursesResponseClass = {
  classId?: unknown;
  courseId?: unknown;
  className?: unknown;
  semester?: unknown;
};

type TeachingCoursesResponseMembership = {
  courseId?: unknown;
  classId?: unknown;
  membershipStatus?: unknown;
};

type TeachingCoursesResponseBody = {
  courses?: TeachingCoursesResponseCourse[];
  classes?: TeachingCoursesResponseClass[];
  memberships?: TeachingCoursesResponseMembership[];
};

function getValidatedCourseId(courseId: string | undefined) {
  return courseId && Object.hasOwn(playbackByCourseId, courseId)
    ? courseId
    : fallbackCourseId;
}

function getStringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function findApprovedInviteLearningContext(
  body: TeachingCoursesResponseBody,
  courseId: string,
  classId: string,
): ApprovedInviteLearningContext | undefined {
  const matchingMembership = body.memberships?.find(
    (membership) =>
      getStringValue(membership.courseId) === courseId &&
      getStringValue(membership.classId) === classId &&
      getStringValue(membership.membershipStatus) === "approved",
  );
  if (!matchingMembership) {
    return undefined;
  }

  const course = body.courses?.find(
    (courseItem) => getStringValue(courseItem.courseId) === courseId,
  );
  const classItem = body.classes?.find(
    (candidateClass) =>
      getStringValue(candidateClass.courseId) === courseId &&
      getStringValue(candidateClass.classId) === classId,
  );
  const courseName = getStringValue(course?.courseName);
  const className = getStringValue(classItem?.className);

  if (!courseName || !className) {
    return undefined;
  }

  return {
    courseId,
    classId,
    courseName,
    className,
    semester: getStringValue(classItem?.semester) ?? getStringValue(course?.semester),
  };
}

export function LearningPage({ initialCourseId, initialClassId }: LearningPageProps = {}) {
  const { locale } = useAppPreferences();
  const t = copy[locale];
  const selectedCourseId = getValidatedCourseId(initialCourseId);
  const playback = getPlaybackContent(selectedCourseId, locale);
  const [publishedPlayback, setPublishedPlayback] =
    useState<LearningPptPlaybackManifest>();
  const [approvedInviteLearningContext, setApprovedInviteLearningContext] =
    useState<ApprovedInviteLearningContext>();
  const [publishedPlaybackError, setPublishedPlaybackError] =
    useState<PublishedPlaybackError>();
  const [activePublishedSlideIndex, setActivePublishedSlideIndex] = useState(0);
  const [activeCompanionView, setActiveCompanionView] = useState<CompanionView>("ai");
  const [studyToolsOpen, setStudyToolsOpen] = useState(false);
  const [guideDraft, setGuideDraft] = useState("");
  const [guideFocusSequence, setGuideFocusSequence] = useState(0);
  const activePublishedSlide =
    publishedPlayback?.slides[activePublishedSlideIndex] ?? publishedPlayback?.slides[0];
  const studyContent = useMemo(
    () =>
      createSlideStudyContent({
        locale,
        playback,
        publishedPlayback,
        activePublishedSlide,
      }),
    [activePublishedSlide, locale, playback, publishedPlayback],
  );

  function showPreviousPublishedSlide() {
    setActivePublishedSlideIndex((currentIndex) => Math.max(0, currentIndex - 1));
  }

  function showNextPublishedSlide() {
    setActivePublishedSlideIndex((currentIndex) => {
      const lastSlideIndex = Math.max(0, (publishedPlayback?.slides.length ?? 0) - 1);
      return Math.min(lastSlideIndex, currentIndex + 1);
    });
  }

  function handleStudyAction(action: StudyAction) {
    if (action === "export") {
      exportSlideStudyNotes(studyContent, locale);
      return;
    }

    if (action === "ask") {
      setActiveCompanionView("ai");
      setStudyToolsOpen(false);
      setGuideDraft(createAskThisSlidePrompt(studyContent, locale));
      setGuideFocusSequence((current) => current + 1);
      return;
    }

    setActiveCompanionView(action);
    setStudyToolsOpen(true);
  }

  function openStudyToolsFromDock() {
    setActiveCompanionView(getSelectedStudyToolView(activeCompanionView));
    setStudyToolsOpen(true);
  }

  useEffect(() => {
    let cancelled = false;

    if (!initialCourseId || !initialClassId) {
      return () => {
        cancelled = true;
      };
    }
    const requestedCourseId = initialCourseId;
    const requestedClassId = initialClassId;

    async function loadApprovedInviteLearningContext() {
      try {
        const response = await fetch("/api/teaching/courses", {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error("Student course memberships are not ready.");
        }
        const body = (await response.json()) as TeachingCoursesResponseBody;
        const context = findApprovedInviteLearningContext(
          body,
          requestedCourseId,
          requestedClassId,
        );
        if (!cancelled) {
          setApprovedInviteLearningContext(context);
        }
      } catch {
        if (!cancelled) {
          setApprovedInviteLearningContext(undefined);
        }
      }
    }

    void loadApprovedInviteLearningContext();

    return () => {
      cancelled = true;
    };
  }, [initialClassId, initialCourseId]);

  useEffect(() => {
    let cancelled = false;

    async function loadPublishedPlayback() {
      try {
        setPublishedPlaybackError(undefined);
        const response = await fetch(
          `/api/learning/ppt-playback/${publishedLearningPptCourseId}?locale=${encodeURIComponent(locale)}`,
        );
        if (!response.ok) {
          if (!cancelled) {
            setPublishedPlayback(undefined);
            setPublishedPlaybackError(getPublishedPlaybackError(response.status));
          }
          return;
        }
        const body = (await response.json()) as {
          playback?: LearningPptPlaybackManifest;
        };
        if (!cancelled && body.playback && body.playback.slides.length > 0) {
          setPublishedPlayback(body.playback);
          setActivePublishedSlideIndex(0);
          setPublishedPlaybackError(undefined);
          return;
        }
        if (!cancelled) {
          setPublishedPlayback(undefined);
          setPublishedPlaybackError("unavailable");
        }
      } catch {
        if (!cancelled) {
          setPublishedPlayback(undefined);
          setPublishedPlaybackError("unavailable");
        }
      }
    }

    void loadPublishedPlayback();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const visibleApprovedInviteLearningContext =
    approvedInviteLearningContext?.courseId === initialCourseId &&
    approvedInviteLearningContext?.classId === initialClassId
      ? approvedInviteLearningContext
      : undefined;
  const visibleCourseContextTitle = publishedPlayback
    ? `${locale === "zh-CN" ? "当前课程：" : "Current course: "}${publishedPlayback.courseTitle}`
    : playback.liveHint;
  const visibleCourseContextSlideTitle = activePublishedSlide?.slideTitle ?? playback.slideTitle;

  return (
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 bg-[#f7f8fd] px-3 py-3 text-[#141833] sm:px-4 lg:px-5">
      <Link href="/learning/chatroom" className="sr-only">
        {t.learning.openChatroom}
      </Link>
      <div
        data-uais-learning-course-context="selected-course"
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm font-semibold text-[#303650]"
      >
        <span>{visibleCourseContextTitle}</span>
        <span className="text-[#9aa2b8]">/</span>
        <span className="text-[#697089]">{visibleCourseContextSlideTitle}</span>
        {visibleApprovedInviteLearningContext ? (
          <>
            <span className="text-[#9aa2b8]">/</span>
            <span className="text-[#1f6feb]">
              {visibleApprovedInviteLearningContext.courseName}
            </span>
            <span className="text-[#697089]">
              {visibleApprovedInviteLearningContext.className}
            </span>
            {visibleApprovedInviteLearningContext.semester ? (
              <span className="text-[#697089]">
                {visibleApprovedInviteLearningContext.semester}
              </span>
            ) : null}
            <span className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-2 py-0.5 text-xs font-semibold text-[#1f6feb]">
              {locale === "zh-CN" ? "已通过邀请码加入" : "Joined by approved invite code"}
            </span>
          </>
        ) : null}
      </div>
      <section
        data-uais-learning-layout="page-right-companion"
        className="grid w-full items-start gap-3 xl:grid-cols-[156px_minmax(0,1fr)_420px]"
      >
        <SlideChapterRail
          locale={locale}
          publishedPlayback={publishedPlayback}
          activePublishedSlideIndex={activePublishedSlideIndex}
          onSelectPublishedSlide={setActivePublishedSlideIndex}
        />
        <div
          data-uais-learning-playback-workspace="single-viewport"
          className="grid min-w-0 gap-6 xl:max-h-[calc(100dvh-6.5rem)] xl:grid-rows-[minmax(0,1fr)_auto] xl:overflow-hidden"
        >
          <PptStage
            locale={locale}
            publishedPlayback={publishedPlayback}
            activePublishedSlide={activePublishedSlide}
            publishedPlaybackError={publishedPlaybackError}
            conceptCount={studyContent.concepts.length}
            onStudyAction={handleStudyAction}
          />
          <NarrationDock
            locale={locale}
            playback={playback}
            publishedPlayback={publishedPlayback}
            activePublishedSlide={activePublishedSlide}
            activePublishedSlideIndex={activePublishedSlideIndex}
            onPreviousPublishedSlide={showPreviousPublishedSlide}
            onNextPublishedSlide={showNextPublishedSlide}
            studyToolsOpen={studyToolsOpen}
            onOpenStudyTools={openStudyToolsFromDock}
          />
        </div>
        <LearningCompanionPanel
          locale={locale}
          courseId={selectedCourseId}
          playback={playback}
          publishedPlayback={publishedPlayback}
          activePublishedSlide={activePublishedSlide}
          onSelectPublishedSlide={setActivePublishedSlideIndex}
          studyContent={studyContent}
          activeView={activeCompanionView}
          onActiveViewChange={setActiveCompanionView}
          studyToolsOpen={studyToolsOpen}
          onStudyToolsOpenChange={setStudyToolsOpen}
          guideDraft={guideDraft}
          onGuideDraftChange={setGuideDraft}
          guideFocusSequence={guideFocusSequence}
        />
      </section>
    </div>
  );
}

export function LearningChatroomPage() {
  const { locale } = useAppPreferences();
  const t = copy[locale];

  return (
    <div className="space-y-4">
      <Link
        href="/learning"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] shadow-[0_10px_28px_var(--shadow)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <ArrowLeft size={17} weight="bold" />
        {t.learning.backToLearning}
      </Link>
      <HumanAiChatroom variant="full" summary={t.learning.fullChatSummary} />
    </div>
  );
}

function LearningCompanionPanel({
  locale,
  courseId,
  playback,
  publishedPlayback,
  activePublishedSlide,
  onSelectPublishedSlide,
  studyContent,
  activeView,
  onActiveViewChange,
  studyToolsOpen,
  onStudyToolsOpenChange,
  guideDraft,
  onGuideDraftChange,
  guideFocusSequence,
}: {
  locale: Locale;
  courseId: string;
  playback: PlaybackContent;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
  onSelectPublishedSlide: (index: number) => void;
  studyContent: SlideStudyContent;
  activeView: CompanionView;
  onActiveViewChange: (view: CompanionView) => void;
  studyToolsOpen: boolean;
  onStudyToolsOpenChange: (open: boolean) => void;
  guideDraft: string;
  onGuideDraftChange: (draft: string) => void;
  guideFocusSequence: number;
}) {
  const [guideMessages, setGuideMessages] = useState<AiGuideMessage[]>([]);
  const [guideError, setGuideError] = useState("");
  const [activeGuideAgentId, setActiveGuideAgentId] =
    useState<LearningAiGuideAgentId>("concept-explainer");
  const [pendingGuideAgentId, setPendingGuideAgentId] =
    useState<LearningAiGuideAgentId | "multi-agent" | null>(null);
  const [expandedCheckpointId, setExpandedCheckpointId] = useState<string>();
  const guideRequestCounterRef = useRef(0);
  const guideInputRef = useRef<HTMLInputElement | null>(null);
  const guideTranscriptRef = useRef<HTMLDivElement | null>(null);
  const guideCopy = getAiGuideCopy(locale, playback, publishedPlayback, activePublishedSlide);
  const activeGuideAgent =
    guideCopy.agentCards.find((agent) => agent.id === activeGuideAgentId) ??
    guideCopy.agentCards[0];
  const transcript = publishedPlayback
    ? publishedPlayback.slides.map((slide, index) => ({
        time: locale === "zh-CN" ? `第 ${slide.slideNumber} 页` : `Slide ${slide.slideNumber}`,
        title: slide.slideTitle,
        text: slide.narrationText,
        active: slide.slideId === activePublishedSlide?.slideId,
        slideIndex: index,
      }))
    : [
    {
      time: "12:18",
      text:
        locale === "zh-CN"
          ? "我们回顾一下损失函数的定义，它衡量了模型预测值与真实值之间的差距。"
          : "We review the definition of loss: the gap between prediction and truth.",
    },
    {
      time: "12:32",
      text:
        locale === "zh-CN"
          ? "为了找到使损失最小的参数，我们需要一种优化方法，梯度下降就是其中最经典的一种。"
          : "To find parameters with the smallest loss, gradient descent is the classic optimizer.",
    },
    {
      time: "12:45",
      text:
        locale === "zh-CN"
          ? "梯度下降的核心思想是：沿着损失函数下降最快的方向不断前进，直到收敛。"
          : "The core idea: move in the fastest descending direction until convergence.",
      active: true,
    },
    {
      time: "13:02",
      text:
        locale === "zh-CN"
          ? "右侧图展示了参数空间中的损失曲面，黑色虚线表示梯度下降的迭代路径。"
          : "The diagram shows the loss surface and the dashed path of gradient descent.",
    },
    {
      time: "13:30",
      text:
        locale === "zh-CN"
          ? "学习率控制了每一步的步长，过大可能越过最优点，过小则收敛缓慢。"
          : "Learning rate controls step size: too large overshoots, too small converges slowly.",
    },
  ];

  const primaryTabs = [
    { view: "ai" as const, label: locale === "zh-CN" ? "智能导学" : "AI Guide" },
    { view: "subtitles" as const, label: locale === "zh-CN" ? "全部字幕" : "Subtitles" },
    { view: "outline" as const, label: locale === "zh-CN" ? "课程目录" : "Outline" },
  ];
  const selectedStudyToolView = getSelectedStudyToolView(activeView);

  function closeStudyTools() {
    onStudyToolsOpenChange(false);
    onActiveViewChange("ai");
  }

  function showPrimaryView(view: PrimaryCompanionView) {
    onStudyToolsOpenChange(false);
    onActiveViewChange(view);
  }

  useEffect(() => {
    if (guideFocusSequence === 0) {
      return;
    }

    guideInputRef.current?.focus();
  }, [guideFocusSequence]);

  useEffect(() => {
    if (guideMessages.length === 0) {
      return;
    }

    const transcript = guideTranscriptRef.current;
    if (transcript) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }, [guideMessages]);

  function handleGuideSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = guideDraft.trim();

    if (!question) {
      setGuideError(locale === "zh-CN" ? "请输入问题后再发送。" : "Please enter a question first.");
      return;
    }

    void requestGuideAgent(activeGuideAgent, question, "multi-agent");
  }

  async function requestGuideAgent(
    agent: (typeof guideCopy.agentCards)[number],
    question: string,
    mode: "single-agent" | "multi-agent" = "single-agent",
  ) {
    guideRequestCounterRef.current += 1;
    const requestId = String(guideRequestCounterRef.current);
    const assistantMessageId = `guide-assistant-${requestId}`;
    const pendingId = mode === "multi-agent" ? "multi-agent" : agent.id;
    setActiveGuideAgentId(agent.id);
    setPendingGuideAgentId(pendingId);
    setGuideMessages((current) => [
      ...current,
      {
        id: `guide-user-${requestId}`,
        kind: "user",
        text: question,
      },
    ]);
    onGuideDraftChange("");
    setGuideError("");

    try {
      const response = await fetch("/api/learning/ai-guide", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createLearningAiGuidePayload(agent.id, question, mode)),
      });
      const body = (await response.json()) as LearningAiGuideApiResponse;
      const assistantText = body.message?.text?.trim();
      if (!response.ok || !assistantText) {
        throw new Error(body.error ?? "Learning AI guide request failed.");
      }

      setGuideMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          kind: "assistant",
          text: assistantText,
          orchestration: body.orchestration,
          hitl: body.orchestration?.trace?.humanInTheLoop
            ? {
                status: "ready",
              }
            : undefined,
        },
      ]);
    } catch {
      setGuideError(
        locale === "zh-CN"
          ? "智能服务暂时不可用，已保留你的问题。"
          : "AI service is temporarily unavailable. Your question is kept above.",
      );
    } finally {
      setPendingGuideAgentId((current) => (current === pendingId ? null : current));
    }
  }

  async function requestGuideHumanReview(
    messageId: string,
    action: "start-review" | "resume-review",
  ) {
    const targetMessage = guideMessages.find((message) => message.id === messageId);
    const threadId =
      targetMessage?.orchestration?.trace?.memory?.threadId ??
      targetMessage?.orchestration?.runtime?.threadId;
    if (!targetMessage || !threadId) {
      return;
    }

    setGuideMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              hitl: {
                ...(message.hitl ?? { status: "ready" as const }),
                busy: true,
              },
            }
          : message,
      ),
    );

    try {
      const response = await fetch("/api/learning/ai-guide/hitl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          graphId: targetMessage.orchestration?.graph?.graphId,
          threadId,
          messageText: targetMessage.text,
          decision: "approved",
          note:
            locale === "zh-CN"
              ? "学习者确认复核并继续。"
              : "Learner confirmed review and resumed.",
        }),
      });
      const body = (await response.json()) as LearningAiGuideHitlApiResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Learning AI guide human review failed.");
      }

      setGuideMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                hitl:
                  body.status === "interrupted"
                    ? {
                        status: "waiting-human",
                        prompt: body.humanInTheLoop?.interrupt?.value?.prompt,
                      }
                    : {
                        status: "resumed",
                        text:
                          body.message?.text ??
                          (locale === "zh-CN"
                            ? "人工复核已完成，线程已恢复。"
                            : "Human review completed and the thread resumed."),
                        decision: body.humanInTheLoop?.decision,
                      },
              }
            : message,
        ),
      );
    } catch {
      setGuideMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                hitl: {
                  status: "failed",
                  text:
                    locale === "zh-CN"
                      ? "人工复核暂时失败，请稍后重试。"
                      : "Human review failed. Please try again.",
                },
              }
            : message,
        ),
      );
    }
  }

  function createLearningAiGuidePayload(
    agentId: LearningAiGuideAgentId,
    question: string,
    mode: "single-agent" | "multi-agent",
  ) {
    const fallbackCourseTitle = playback.liveHint.replace(
      locale === "zh-CN" ? "当前课程：" : "Current course: ",
      "",
    );
    const slideImageUrl = activePublishedSlide?.imageUrl
      ? new URL(activePublishedSlide.imageUrl, window.location.origin).toString()
      : undefined;

    return {
      agentId,
      mode,
      locale,
      question,
      course: {
        courseId: publishedPlayback?.courseId ?? courseId,
        courseTitle: publishedPlayback?.courseTitle ?? fallbackCourseTitle,
      },
      slide: {
        slideNumber: activePublishedSlide?.slideNumber,
        slideTitle: activePublishedSlide?.slideTitle ?? playback.slideTitle,
        narrationText:
          activePublishedSlide?.narrationText ??
          playback.subtitles.find((subtitle) => subtitle.active)?.text,
        imageUrl: slideImageUrl,
      },
    };
  }

  return (
    <aside className="overflow-hidden rounded-2xl border border-[#e2e6f0] bg-white shadow-[0_18px_44px_rgba(46,58,91,0.08)] xl:sticky xl:top-20 xl:h-[calc(100dvh-6.5rem)]">
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-[#e9ecf4] p-3">
          <div
            role="group"
            aria-label={locale === "zh-CN" ? "我的学习右侧栏目切换" : "My Learning right column switcher"}
            className="grid grid-cols-3 gap-2 rounded-lg border border-[#dfe4ef] bg-[#f7f9fd] p-1"
          >
          {primaryTabs.map((tab) => {
            const active = activeView === tab.view;
            return (
              <button
                key={tab.view}
                type="button"
                aria-pressed={active}
                onClick={() => showPrimaryView(tab.view)}
                className={[
                  "h-11 rounded-md border px-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
                  active && !studyToolsOpen
                    ? "border-[#1f6feb] bg-[#1f6feb] text-white shadow-[0_8px_18px_rgba(31,111,235,0.2)]"
                    : "border-transparent bg-white text-[#4f5670] hover:border-[#bfdbfe] hover:text-[#1f6feb]",
                ].join(" ")}
              >
                {tab.label}
              </button>
            );
          })}
          </div>
        </div>

        <div
          className={
            studyToolsOpen
              ? "min-h-0 xl:overflow-y-auto xl:p-4"
              : activeView === "ai"
                ? "min-h-0 overflow-hidden p-4"
                : "overflow-y-auto p-4"
          }
        >
          {studyToolsOpen ? (
            <StudyToolsPanel
              locale={locale}
              studyContent={studyContent}
              activeView={selectedStudyToolView}
              expandedCheckpointId={expandedCheckpointId}
              onToggleCheckpoint={(checkpointId) =>
                setExpandedCheckpointId((current) =>
                  current === checkpointId ? undefined : checkpointId,
                )
              }
              onActiveViewChange={(view) => {
                onActiveViewChange(view);
                onStudyToolsOpenChange(true);
              }}
              onClose={closeStudyTools}
            />
          ) : null}

          {!studyToolsOpen && activeView === "ai" ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#dbeafe] text-[#1f6feb]">
                  <Robot size={22} weight="duotone" />
                </span>
                <div className="rounded-xl bg-[#f0f1f7] px-4 py-3 text-sm leading-6 text-[#303650]">
                  <p>{guideCopy.greeting}</p>
                  <p className="mt-2 text-xs leading-5 text-[#68708a]">
                    {guideCopy.contextHint}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {guideCopy.prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      onGuideDraftChange(prompt);
                      setGuideError("");
                      guideInputRef.current?.focus();
                    }}
                    className="w-fit rounded-lg border border-[#dfe4ef] bg-white px-4 py-2 text-left text-sm font-medium text-[#444b66] shadow-[0_4px_12px_rgba(46,58,91,0.04)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div
                ref={guideTranscriptRef}
                role="log"
                tabIndex={0}
                aria-label={locale === "zh-CN" ? "智能导学对话" : "AI guide conversation"}
                aria-live="polite"
                className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 outline-none focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
              >
                {guideMessages.map((message) => (
                  <div
                    key={message.id}
                    className={[
                      "max-w-[92%] rounded-xl px-4 py-3 text-sm leading-6",
                      message.kind === "user"
                        ? "ml-auto bg-[#1f6feb] text-white"
                        : "bg-[#f0f1f7] text-[#303650]",
                    ].join(" ")}
                  >
                    <p className="whitespace-pre-line">{message.text}</p>
                    {message.kind === "assistant" &&
                    message.orchestration?.graph?.runtime === "langgraph" ? (
                      <LangGraphTracePanel
                        locale={locale}
                        orchestration={message.orchestration}
                        humanReview={message.hitl}
                        onHumanReviewAction={(action) =>
                          void requestGuideHumanReview(message.id, action)
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="mt-5 grid shrink-0 grid-cols-3 gap-2">
              {guideCopy.agentCards.map((agent) => {
                const Icon = agent.icon;
                const active = activeGuideAgentId === agent.id;
                const pending = pendingGuideAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    aria-pressed={active}
                    disabled={pendingGuideAgentId !== null}
                    onClick={() => void requestGuideAgent(agent, agent.prompt)}
                    className={[
                      "rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
                      active
                        ? "border-[#1f6feb] bg-[#f8fbff] shadow-[0_10px_22px_rgba(31,111,235,0.12)]"
                        : "border-[#e1e5ef] bg-[#fbfcff] hover:border-[#1f6feb]",
                      pendingGuideAgentId !== null && !pending ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    <Icon size={18} weight="duotone" className="text-[#1f6feb]" />
                    <p className="mt-2 text-xs font-semibold text-[#303650]">{agent.label}</p>
                    <p className="mt-1 text-[11px] text-[#7b8399]">
                      {pending
                        ? locale === "zh-CN"
                          ? "正在连接"
                          : "Connecting"
                        : agent.sub}
                    </p>
                  </button>
                );
              })}
              </div>

              <form
                onSubmit={handleGuideSend}
                className="mt-4 shrink-0 rounded-xl border border-[#dfe4ef] bg-white p-3 shadow-[0_8px_18px_rgba(46,58,91,0.05)]"
              >
              <div className="flex items-center gap-2">
                <input
                  ref={guideInputRef}
                  aria-label={locale === "zh-CN" ? "向智能助教提问" : "Ask AI"}
                  value={guideDraft}
                  onChange={(event) => {
                    onGuideDraftChange(event.target.value);
                    setGuideError("");
                  }}
                  placeholder={locale === "zh-CN" ? "向智能助教提问..." : "Ask the AI assistant..."}
                  className="h-10 min-w-0 flex-1 rounded-lg bg-[#fafbff] px-3 text-sm outline-none placeholder:text-[#a4aabd] focus:ring-2 focus:ring-[#1f6feb]"
                />
                <button
                  type="submit"
                  disabled={pendingGuideAgentId !== null}
                  aria-busy={pendingGuideAgentId === "multi-agent"}
                  className="grid size-10 place-items-center rounded-full bg-[#1f6feb] text-white outline-none transition hover:bg-[#1759c8] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb] focus-visible:ring-offset-2"
                  aria-label={locale === "zh-CN" ? "发送" : "Send"}
                >
                  <PaperPlaneTilt size={18} weight="fill" />
                </button>
              </div>
              <p
                aria-live="polite"
                className="mt-2 min-h-4 text-xs font-medium text-[var(--danger)]"
              >
                {guideError}
              </p>
              </form>
            </div>
          ) : null}

          {!studyToolsOpen && activeView === "subtitles" ? (
          <div>
            <div className="space-y-4">
              {transcript.map((line) => {
                const isPublishedLine = "slideIndex" in line;
                const rowClassName = [
                  "grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-lg px-2 py-1 text-sm leading-6",
                  line.active ? "bg-[#dbeafe] text-[#1f6feb]" : "text-[#535b76]",
                  isPublishedLine
                    ? "w-full text-left outline-none transition hover:bg-[#eff6ff] focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
                    : "",
                ].join(" ");
                const timeClassName = line.active
                  ? "font-semibold text-[#1f6feb]"
                  : "text-[#8991a8]";
                const rowContent = (
                  <>
                    <span className={timeClassName}>{line.time}</span>
                    <p>{line.text}</p>
                  </>
                );

                if (isPublishedLine) {
                  const jumpLabel =
                    locale === "zh-CN"
                      ? `跳转到${line.time}：${line.title}`
                      : `Jump to ${line.time}: ${line.title}`;

                  return (
                    <button
                      key={line.time}
                      type="button"
                      aria-label={jumpLabel}
                      aria-current={line.active ? "page" : undefined}
                      data-uais-learning-subtitle-page={line.time}
                      onClick={() => onSelectPublishedSlide(line.slideIndex)}
                      className={rowClassName}
                    >
                      {rowContent}
                    </button>
                  );
                }

                return (
                  <div key={line.time} className={rowClassName}>
                    {rowContent}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-2">
              <input
                aria-label={locale === "zh-CN" ? "搜索当前页字幕" : "Search subtitles"}
                placeholder={locale === "zh-CN" ? "搜索当前页字幕" : "Search subtitles"}
                className="h-10 min-w-0 flex-1 rounded-lg border border-[#e1e5ef] bg-white px-3 text-sm outline-none placeholder:text-[#a4aabd] focus:ring-2 focus:ring-[#1f6feb]"
              />
              <button type="button" className="grid size-10 place-items-center rounded-lg border border-[#e1e5ef] bg-white text-[#1f6feb]" aria-label={locale === "zh-CN" ? "筛选字幕" : "Filter subtitles"}>
                <SlidersHorizontal size={18} weight="duotone" />
              </button>
            </div>
          </div>
          ) : null}

          {!studyToolsOpen && activeView === "outline" ? <CourseDirectoryView locale={locale} /> : null}
        </div>
      </div>
    </aside>
  );
}


function getAiGuideCopy(
  locale: Locale,
  playback: PlaybackContent,
  publishedPlayback?: LearningPptPlaybackManifest,
  activePublishedSlide?: LearningPptPlaybackSlide,
) {
  const courseTitle =
    publishedPlayback?.courseTitle ??
    playback.liveHint.replace(locale === "zh-CN" ? "当前课程：" : "Current course: ", "");
  const slideTitle = activePublishedSlide?.slideTitle ?? playback.slideTitle;
  const slidePosition = activePublishedSlide
    ? locale === "zh-CN"
      ? `第 ${activePublishedSlide.slideNumber} 页`
      : `slide ${activePublishedSlide.slideNumber}`
    : playback.slideLabel;
  const guideContext =
    activePublishedSlide?.narrationText ??
    playback.subtitles.find((subtitle) => subtitle.active)?.text ??
    playback.aiMessages[0]?.body;

  if (locale === "zh-CN") {
    return {
      greeting: `你好！我是《${courseTitle}》智能导学，会围绕当前${slidePosition}「${slideTitle}」帮你总结、答疑和拓展学习。`,
      contextHint: `当前讲解线索：${guideContext}`,
      prompts: [
        `解释「${slideTitle}」的核心概念`,
        "把这页整理成 3 个学习要点",
        `根据「${slideTitle}」生成一个课堂提问`,
      ],
      agentCards: [
        {
          id: "learning-advisor" as const,
          label: "学习顾问",
          sub: "学习路径规划",
          icon: BookOpen,
          prompt: `请基于「${slideTitle}」给我一个 10 分钟学习路径`,
        },
        {
          id: "concept-explainer" as const,
          label: "概念解读",
          sub: "知识点解析",
          icon: Sparkle,
          prompt: `解释「${slideTitle}」的核心概念、常见误区和例子`,
        },
        {
          id: "code-assistant" as const,
          label: "代码助手",
          sub: "算法与实现",
          icon: GearSix,
          prompt: `把「${slideTitle}」转成步骤、伪代码或短代码示例`,
        },
      ],
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
    agentCards: [
      {
        id: "learning-advisor" as const,
        label: "Study Advisor",
        sub: "Path planning",
        icon: BookOpen,
        prompt: `Give me a 10-minute study path for "${slideTitle}"`,
      },
      {
        id: "concept-explainer" as const,
        label: "Concepts",
        sub: "Explain ideas",
        icon: Sparkle,
        prompt: `Explain the core idea, misconception, and example for "${slideTitle}"`,
      },
      {
        id: "code-assistant" as const,
        label: "Teaching TA",
        sub: "Examples and questions",
        icon: Target,
        prompt: `Create a classroom question and teaching example for "${slideTitle}"`,
      },
    ],
    multiAgentLabel: "LangGraph multi-agent guide",
    buildReceipt: (question: string) =>
      `AI Guide received: ${question}. I will connect ${courseTitle}, the current ${slidePosition} "${slideTitle}", subtitles, and outline for you.`,
    buildMultiAgentReceipt: (question: string) =>
      `The multi-agent chain received: ${question}. Study Advisor, Concept Explainer, and Teaching TA will work together.`,
  };
}

function CourseDirectoryView({ locale }: { locale: Locale }) {
  const chapters = courseDirectoryChapters.map((chapter, chapterIndex) => ({
    title: chapter.title[locale],
    time: chapter.time,
    lessons: chapter.lessons.map((lesson, lessonIndex) => {
      const active = chapterIndex === 0 && lessonIndex === 1;

      return {
        title: lesson.title[locale],
        time: courseDirectoryLessonTimes[lessonIndex % courseDirectoryLessonTimes.length],
        active,
        done: !active,
      };
    }),
  }));

  return (
    <div>
      <div className="rounded-xl border border-[#e8ebf4] bg-white p-4">
        <div className="flex gap-3">
          <div className="grid size-16 place-items-center rounded-lg bg-[linear-gradient(135deg,#1f6feb,#93c5fd)] text-white">
            <BookOpen size={24} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[#222842]">
              {locale === "zh-CN"
                ? "初等数学研究（2024 春）"
                : "Elementary Mathematics Research (Spring 2024)"}
            </h2>
            <p className="mt-2 text-sm text-[#697089]">
              {locale === "zh-CN" ? "康霞博士" : "Dr. Kang Xia"}
            </p>
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs font-semibold text-[#697089]">
                <span>{locale === "zh-CN" ? "学习进度" : "Progress"}</span>
                <span className="text-[#1f6feb]">42%</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[#e7eaf2]">
                <div className="h-1.5 w-[42%] rounded-full bg-[#1f6feb]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        {chapters.map((chapter) => (
          <div key={chapter.title} className="border-b border-[#eceff5] py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3 text-sm font-semibold text-[#303650]">
              <span>{chapter.title}</span>
              <span className="shrink-0 text-[#858ca4]">{chapter.time}</span>
            </div>
            {chapter.lessons ? (
              <div className="mt-3 space-y-1">
                {chapter.lessons.map((lesson) => (
                  <button
                    type="button"
                    key={lesson.title}
                    className={[
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm outline-none transition",
                      lesson.active ? "bg-[#dbeafe] text-[#1f6feb]" : "text-[#4d5570] hover:bg-[#f7f8fd]",
                    ].join(" ")}
                  >
                    <span>{lesson.title}</span>
                    <span className="flex items-center gap-2 text-[#858ca4]">
                      {lesson.time}
                      {lesson.active ? (
                        <PlayCircle size={18} weight="fill" className="text-[#1f6feb]" />
                      ) : lesson.done ? (
                        <CheckCircle size={16} weight="duotone" />
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-[#858ca4]">›</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-[#eceff5] pt-4">
        <button type="button" className="flex h-12 w-full items-center justify-between rounded-xl border border-[#e1e5ef] bg-white px-4 text-sm font-semibold text-[#4a5068]">
          <span className="inline-flex items-center gap-2">
            <FilePdf size={18} weight="duotone" />
            {locale === "zh-CN" ? "课程资料" : "Course materials"}
          </span>
          <ArrowRight size={17} weight="bold" />
        </button>
      </div>
    </div>
  );
}

type HumanAiChatroomProps = {
  variant?: "embedded" | "full";
  summary?: string;
};

export function HumanAiChatroom({ variant = "embedded", summary }: HumanAiChatroomProps) {
  const { locale } = useAppPreferences();
  const t = copy[locale];
  const [messages, setMessages] = useState<ChatMessage[]>(chatMessages);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const isFullPage = variant === "full";

  function mentionAgent(handle: string) {
    setDraft((current) => `${current.trimEnd()}${current.trim() ? " " : ""}${handle} `);
    setError("");
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDraft = draft.trim();
    if (!trimmedDraft) {
      setError(t.learning.error);
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: `local-${current.length + 1}`,
        kind: "student",
        author: {
          "zh-CN": "我",
          "en-US": "Me",
        },
        text: {
          "zh-CN": trimmedDraft,
          "en-US": trimmedDraft,
        },
        time: locale === "zh-CN" ? "刚刚" : "Now",
      },
    ]);
    setDraft("");
    setError("");
    setNotice("");
  }

  function handleExport() {
    const result = exportChatToPdf(messages);
    setNotice(`${t.learning.exported} ${result.fileName}`);
    setError("");
  }

  async function handleShare() {
    const link = createShareLink("research-method-group");
    try {
      await navigator.clipboard?.writeText(link);
      setNotice(`${t.learning.copied} ${link}`);
    } catch {
      setNotice(`${t.learning.copiedFallback} ${link}`);
    }
    setError("");
  }

  return (
    <section
      className={[
        "rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_48px_var(--shadow)]",
        isFullPage ? "p-5 md:p-7" : "p-5",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <ChatsCircle size={22} weight="duotone" />
            </span>
            <h2 className="text-xl font-semibold text-[var(--foreground)]">
              {t.learning.chatTitle}
            </h2>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {summary ?? t.learning.chatSummary}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <FilePdf size={17} weight="duotone" />
            {t.learning.exportPdf}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
          >
            <LinkSimple size={17} weight="bold" />
            {t.learning.shareLink}
          </button>
        </div>
      </div>

      <div
        className={[
          "mt-4 grid gap-4",
          isFullPage ? "xl:grid-cols-[0.72fr_1.28fr]" : "xl:grid-cols-[0.78fr_1.22fr]",
        ].join(" ")}
      >
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--foreground)]">
            {locale === "zh-CN" ? "@智能体" : "@AI Agents"}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {aiAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => mentionAgent(getLocalizedAgentHandle(agent.id, agent.handle, locale))}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left outline-none transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                  <Robot size={17} weight="duotone" className="text-[var(--accent)]" />
                  {getLocalizedAgentHandle(agent.id, agent.handle, locale)}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                  {localizedText(agent.specialty, locale)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          className={[
            "flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)]",
            isFullPage ? "min-h-[620px]" : "min-h-[520px]",
          ].join(" ")}
        >
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                {t.learning.emptyChat}
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={[
                    "rounded-2xl border p-4",
                    message.kind === "agent"
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] bg-[var(--surface)]",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-[var(--foreground)]">
                      {localizedText(message.author, locale)}
                    </p>
                    <span className="text-xs font-medium text-[var(--muted)]">
                      {message.time}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {getLocalizedChatMessageText(message, locale)}
                  </p>
                </article>
              ))
            )}
          </div>

          <form
            onSubmit={handleSend}
            className="border-t border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <label
              htmlFor="group-message"
              className="text-sm font-semibold text-[var(--foreground)]"
            >
              {t.learning.inputLabel}
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="group-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t.learning.inputPlaceholder}
                className="min-h-11 flex-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              >
                <PaperPlaneTilt size={17} weight="bold" />
                {t.learning.send}
              </button>
            </div>
            {error ? (
              <p className="mt-2 text-sm font-medium text-[var(--danger)]">{error}</p>
            ) : null}
            {notice ? (
              <p className="mt-2 text-sm font-medium text-[var(--accent)]" aria-live="polite">
                {notice}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}

function getLocalizedAgentHandle(agentId: string, fallbackHandle: string, locale: Locale) {
  if (locale === "zh-CN") {
    return fallbackHandle;
  }

  return englishAgentHandlesById[agentId] ?? fallbackHandle;
}

function getLocalizedChatMessageText(message: ChatMessage, locale: Locale) {
  const text = localizedText(message.text, locale);
  if (locale === "zh-CN") {
    return text;
  }

  return text
    .replaceAll("@研究助教", englishAgentHandlesById["research-assistant"])
    .replaceAll("@方法顾问", englishAgentHandlesById["methods-consultant"])
    .replaceAll("@数学助教", englishAgentHandlesById["math-tutor"])
    .replaceAll("@写作助手", englishAgentHandlesById["writing-helper"]);
}

const englishAgentHandlesById: Record<string, string> = {
  "research-assistant": "@ResearchTA",
  "methods-consultant": "@MethodsAdvisor",
  "math-tutor": "@MathTA",
  "writing-helper": "@WritingHelper",
};
