"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ChatTeardropText } from "@phosphor-icons/react/dist/ssr/ChatTeardropText";
import { ChatsCircle } from "@phosphor-icons/react/dist/ssr/ChatsCircle";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { CornersIn } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOut } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { LinkSimple } from "@phosphor-icons/react/dist/ssr/LinkSimple";
import { Notebook } from "@phosphor-icons/react/dist/ssr/Notebook";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { PauseCircle } from "@phosphor-icons/react/dist/ssr/PauseCircle";
import { PlayCircle } from "@phosphor-icons/react/dist/ssr/PlayCircle";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerSlash } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Target } from "@phosphor-icons/react/dist/ssr/Target";
import { X } from "@phosphor-icons/react/dist/ssr/X";
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
  getPublishedPlaybackErrorLabel,
  type SlideStudyContent,
  type PublishedPlaybackError,
} from "./learning-page-helpers";

type StudyAction = "ask" | "notes" | "checkpoint" | "concepts" | "export";

type PrimaryCompanionView = "ai" | "subtitles" | "outline";

type StudyToolView = "notes" | "checkpoint" | "concepts";

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

type AiGuideHumanReviewState = {
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

type LearningAiGuideOrchestration = {
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

function LangGraphTracePanel({
  locale,
  orchestration,
  humanReview,
  onHumanReviewAction,
}: {
  locale: Locale;
  orchestration: LearningAiGuideOrchestration;
  humanReview?: AiGuideHumanReviewState;
  onHumanReviewAction?: (action: "start-review" | "resume-review") => void;
}) {
  const graphId = orchestration.graph?.graphId ?? "langgraph";
  const supervisorNodeId =
    orchestration.graph?.supervisorNodeId ??
    orchestration.trace?.handoffs?.find((handoff) =>
      handoff.fromNodeId?.includes("supervisor"),
    )?.fromNodeId;
  const runtime = orchestration.runtime;
  const memory = orchestration.trace?.memory;
  const humanInTheLoop = orchestration.trace?.humanInTheLoop;
  const turns = orchestration.turns ?? [];
  const handoffs = orchestration.trace?.handoffs ?? [];
  const traceTitle = locale === "zh-CN" ? "LangGraph 执行追踪" : "LangGraph trace";
  const runtimeLabel = locale === "zh-CN" ? "运行状态" : "Runtime";
  const memoryLabel = locale === "zh-CN" ? "记忆检查点" : "Memory checkpoint";
  const supervisorLabel = locale === "zh-CN" ? "监督节点" : "Supervisor";
  const handoffLabel = locale === "zh-CN" ? "移交" : "Handoff";
  const currentHumanReview =
    humanReview ??
    (humanInTheLoop
      ? {
          status: "ready" as const,
        }
      : undefined);
  const humanReviewText = formatHumanReviewText(locale, currentHumanReview);
  const humanReviewAction = getHumanReviewAction(currentHumanReview);

  return (
    <div
      data-uais-langgraph-trace={graphId}
      className="mt-3 border-t border-[#dce2ef] pt-3 text-xs leading-5 text-[#4f5670]"
    >
      <div className="flex items-center gap-2 font-semibold text-[#26314f]">
        <Sparkle size={14} weight="fill" className="text-[#1f6feb]" />
        <span>{traceTitle}</span>
      </div>
      <div className="mt-2 grid gap-2 rounded-lg border border-[#dfe5f2] bg-white/70 p-2">
        <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
          <span className="text-[#7a8299]">Graph</span>
          <span className="break-words font-semibold text-[#303650]">{graphId}</span>
        </div>
        {supervisorNodeId ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[#7a8299]">{supervisorLabel}</span>
            <span className="break-words font-semibold text-[#303650]">
              {supervisorNodeId}
            </span>
          </div>
        ) : null}
        {runtime ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[#7a8299]">{runtimeLabel}</span>
            <span className="break-words text-[#303650]">
              {runtime.status ?? "completed"}
              {typeof runtime.eventCount === "number"
                ? ` · ${runtime.eventCount} events`
                : ""}
            </span>
          </div>
        ) : null}
        {memory ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[#7a8299]">{memoryLabel}</span>
            <span className="break-words text-[#303650]">
              {memory.mode ?? "thread-checkpoint"}
              {memory.threadId ? ` · ${memory.threadId}` : ""}
              {memory.store ? ` · ${memory.store}` : ""}
            </span>
          </div>
        ) : null}
        {humanInTheLoop ? (
          <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2">
            <span className="text-[#7a8299]">HITL</span>
            <span className="break-words text-[#303650]">
              Human-in-the-loop · {humanInTheLoop.status ?? "ready"}
              {humanInTheLoop.resumeMode ? ` · ${humanInTheLoop.resumeMode}` : ""}
            </span>
          </div>
        ) : null}
        {currentHumanReview ? (
          <div className="grid gap-2 border-t border-[#e4e8f2] pt-2">
            <div className="break-words text-[#303650]">{humanReviewText}</div>
            {humanReviewAction && onHumanReviewAction ? (
              <button
                type="button"
                disabled={currentHumanReview.busy}
                onClick={() => onHumanReviewAction(humanReviewAction)}
                className="w-fit rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-2.5 py-1 text-xs font-semibold text-[#1f6feb] outline-none transition hover:border-[#1f6feb] focus-visible:ring-2 focus-visible:ring-[#1f6feb] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {getHumanReviewActionLabel(locale, humanReviewAction, currentHumanReview.busy)}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {turns.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {turns.map((turn, index) => (
            <div
              key={`${turn.agentId ?? "agent"}-${index}`}
              className="rounded-md bg-white/60 px-2 py-1"
            >
              <span className="font-semibold text-[#303650]">
                {turn.label ?? turn.agentId ?? "Agent"} · {turn.providerRole ?? "agent"}
              </span>
              {turn.content ? (
                <span className="ml-1 text-[#6c748b]">{turn.content}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {handoffs.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {handoffs.slice(0, 3).map((handoff, index) => (
            <div
              key={`${handoff.fromNodeId ?? "from"}-${handoff.toNodeId ?? "to"}-${index}`}
              className="break-words rounded-md bg-[#f8fbff] px-2 py-1 text-[#5b647d]"
            >
              {handoffLabel}: {handoff.fromNodeId ?? "node"} →{" "}
              {handoff.toNodeId ?? "node"}
              {handoff.reason ? ` · ${handoff.reason}` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getHumanReviewAction(review: AiGuideHumanReviewState | undefined) {
  if (!review || review.busy) {
    return undefined;
  }
  if (review.status === "ready" || review.status === "failed") {
    return "start-review" as const;
  }
  if (review.status === "waiting-human") {
    return "resume-review" as const;
  }
  return undefined;
}

function getHumanReviewActionLabel(
  locale: Locale,
  action: "start-review" | "resume-review",
  busy: boolean | undefined,
) {
  if (busy) {
    return locale === "zh-CN" ? "处理中" : "Working";
  }
  if (action === "resume-review") {
    return locale === "zh-CN" ? "确认复核并恢复" : "Approve and resume";
  }
  return locale === "zh-CN" ? "发起人工复核" : "Start human review";
}

function formatHumanReviewText(
  locale: Locale,
  review: AiGuideHumanReviewState | undefined,
) {
  if (!review) {
    return "";
  }
  if (review.busy) {
    return locale === "zh-CN" ? "正在处理人工复核..." : "Processing human review...";
  }
  if (review.status === "waiting-human") {
    return review.prompt
      ? `${locale === "zh-CN" ? "等待人工复核" : "Waiting for human review"} · ${review.prompt}`
      : locale === "zh-CN"
        ? "等待人工复核"
        : "Waiting for human review";
  }
  if (review.status === "resumed") {
    return review.text
      ? review.text
      : locale === "zh-CN"
        ? "人工复核已完成，线程已恢复。"
        : "Human review completed and the thread resumed.";
  }
  if (review.status === "failed") {
    return review.text
      ? review.text
      : locale === "zh-CN"
        ? "人工复核暂时失败，请稍后重试。"
        : "Human review failed. Please try again.";
  }
  return locale === "zh-CN"
    ? "人工复核已准备好，可发起复核。"
    : "Human review is ready.";
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

function SlideChapterRail({
  locale,
  publishedPlayback,
  activePublishedSlideIndex,
  onSelectPublishedSlide,
}: {
  locale: Locale;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlideIndex: number;
  onSelectPublishedSlide: (index: number) => void;
}) {
  const slides = publishedPlayback
    ? publishedPlayback.slides.map((slide, index) => ({
        number: String(slide.slideNumber).padStart(2, "0"),
        title: slide.slideTitle,
        active: index === activePublishedSlideIndex,
        onClick: () => onSelectPublishedSlide(index),
      }))
    : [
    { number: "28", title: locale === "zh-CN" ? "3.1 线性回归问题" : "3.1 Linear regression" },
    { number: "29", title: locale === "zh-CN" ? "最小二乘法原理" : "Least squares" },
    { number: "30", title: locale === "zh-CN" ? "梯度下降算法" : "Gradient descent", active: true },
    { number: "31", title: locale === "zh-CN" ? "学习率的影响" : "Learning rate" },
    { number: "32", title: locale === "zh-CN" ? "正则化方法" : "Regularization" },
    { number: "33", title: locale === "zh-CN" ? "小结" : "Summary" },
    { number: "34", title: locale === "zh-CN" ? "课堂练习" : "Practice" },
  ];

  return (
    <aside className="overflow-hidden rounded-2xl border border-[#e4e7f1] bg-white shadow-[0_18px_38px_rgba(46,58,91,0.08)] xl:sticky xl:top-20 xl:h-[calc(100dvh-6.5rem)]">
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex h-12 items-center justify-between border-b border-[#e8ebf4] px-3 text-sm font-semibold text-[#303650]">
          <span>
            {publishedPlayback
              ? locale === "zh-CN"
        ? `课件 1 / ${publishedPlayback.slideCount}`
                : `PPT 1 / ${publishedPlayback.slideCount}`
              : locale === "zh-CN"
                ? "章节 3 / 8"
                : "Chapter 3 / 8"}
          </span>
          <span className="text-lg text-[#a5abc0]">×</span>
        </div>
        <div className="flex gap-3 overflow-x-auto p-3 xl:block xl:space-y-3 xl:overflow-y-auto xl:overflow-x-hidden">
          {slides.map((slide) => (
            <button
              key={slide.number}
              type="button"
              onClick={"onClick" in slide ? slide.onClick : undefined}
              className={[
                "relative w-[120px] shrink-0 rounded-xl border bg-white p-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb] xl:w-full",
                slide.active
                  ? "border-[#1f6feb] shadow-[0_12px_24px_rgba(31,111,235,0.16)]"
                  : "border-[#e6e9f2] hover:border-[#93c5fd]",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute -left-2 top-3 flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                  slide.active ? "bg-[#1f6feb] text-white" : "bg-[#d9ddea] text-[#8991a8]",
                ].join(" ")}
              >
                {slide.number}
              </span>
              <span className="ml-3 block min-h-[52px] rounded-lg bg-[#fbfcff] p-2 text-[10px] font-semibold leading-4 text-[#343a57]">
                {slide.title}
                {slide.active ? (
                  <span className="mt-2 block h-7 rounded bg-[linear-gradient(135deg,#eff6ff,#bfdbfe)]" />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function PptStage({
  locale,
  publishedPlayback,
  activePublishedSlide,
  publishedPlaybackError,
  conceptCount,
  onStudyAction,
}: {
  locale: Locale;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
  publishedPlaybackError?: PublishedPlaybackError;
  conceptCount: number;
  onStudyAction: (action: StudyAction) => void;
}) {
  const pptFrameRef = useRef<HTMLElement | null>(null);
  const [isPptFullscreen, setIsPptFullscreen] = useState(false);

  useEffect(() => {
    function syncPptFullscreenState() {
      setIsPptFullscreen(document.fullscreenElement === pptFrameRef.current);
    }

    function exitPptFullscreenWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.fullscreenElement !== pptFrameRef.current) {
        return;
      }

      void document.exitFullscreen?.();
    }

    document.addEventListener("fullscreenchange", syncPptFullscreenState);
    document.addEventListener("keydown", exitPptFullscreenWithEscape);
    return () => {
      document.removeEventListener("fullscreenchange", syncPptFullscreenState);
      document.removeEventListener("keydown", exitPptFullscreenWithEscape);
    };
  }, []);

  function handlePptFullscreenToggle() {
    const pptFrame = pptFrameRef.current;
    if (!pptFrame) {
      return;
    }

    if (document.fullscreenElement === pptFrame) {
      void document.exitFullscreen?.();
      return;
    }

    if (pptFrame.requestFullscreen) {
      void pptFrame.requestFullscreen();
    }
  }

  if (publishedPlayback && activePublishedSlide) {
    const slideImageAlt =
      locale === "zh-CN"
        ? `课件第 ${activePublishedSlide.slideNumber} 页：${activePublishedSlide.slideTitle}`
        : `PPT slide ${activePublishedSlide.slideNumber}: ${activePublishedSlide.slideTitle}`;
    const fullscreenLabel = isPptFullscreen
      ? locale === "zh-CN"
        ? "退出课件全屏"
        : "Exit PPT fullscreen"
      : locale === "zh-CN"
        ? "全屏显示课件"
        : "Show PPT fullscreen";
    const FullscreenIcon = isPptFullscreen ? CornersIn : CornersOut;
    const fullscreenButtonClassName = (placementClassName: string) =>
      [
        "absolute z-10 grid size-10 place-items-center rounded-lg border outline-none transition active:translate-y-px focus-visible:ring-2",
        placementClassName,
        isPptFullscreen
          ? "border-white/30 bg-black/55 text-white shadow-[0_12px_28px_rgba(0,0,0,0.28)] backdrop-blur hover:bg-black/70 focus-visible:ring-white"
          : "border-white/80 bg-white/95 text-[#1f6feb] shadow-[0_10px_24px_rgba(31,111,235,0.16)] backdrop-blur hover:border-[#bfdbfe] hover:bg-white focus-visible:ring-[#1f6feb]",
      ].join(" ");
    const fullscreenButton = (placementClassName: string) => (
      <button
        type="button"
        aria-label={fullscreenLabel}
        aria-pressed={isPptFullscreen}
        title={fullscreenLabel}
        onClick={handlePptFullscreenToggle}
        className={fullscreenButtonClassName(placementClassName)}
      >
        <FullscreenIcon size={21} weight="bold" />
      </button>
    );

    return (
      <section
        data-uais-learning-ppt-stage="compact"
        className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-[#e2e6f0] bg-white shadow-[0_18px_44px_rgba(46,58,91,0.08)] xl:h-full xl:min-h-[calc(100dvh-13.5rem)]"
      >
        <div
          data-uais-learning-ppt-stage-body="expanded-slide"
          className="relative min-h-0 flex-1 p-4 lg:p-5 xl:grid xl:grid-rows-[auto_minmax(0,1fr)]"
        >
          {!isPptFullscreen ? fullscreenButton("right-5 top-5 lg:right-7 lg:top-7") : null}

          <div
            data-uais-learning-course-path="published-ppt"
            className="inline-flex min-h-10 max-w-[calc(100%-3.5rem)] items-center gap-2 rounded-lg px-1 pr-14 text-sm font-semibold text-[#697089] sm:pr-16"
          >
            <CaretLeft size={18} weight="bold" className="shrink-0 text-[#697089]" />
            <span className="truncate">
              {publishedPlayback.courseTitle} / {locale === "zh-CN" ? "第一讲 / 第一节" : "Lecture 1 / Section 1"}
            </span>
          </div>

          <figure
            ref={pptFrameRef}
            data-uais-learning-ppt-frame="active-slide"
            className={
              isPptFullscreen
                ? "relative flex h-screen w-screen items-center justify-center overflow-hidden rounded-none border-0 bg-black p-0 shadow-none"
                : "relative mx-auto mt-4 flex aspect-[1467/825] w-full max-w-[min(100%,92vw,765px)] min-h-0 items-center justify-center overflow-hidden rounded-xl border border-[#dbeafe] bg-white shadow-[0_18px_42px_rgba(31,111,235,0.08)] xl:mt-3 xl:max-w-[min(100%,103dvh)]"
            }
          >
            {isPptFullscreen ? fullscreenButton("right-4 top-4") : null}
            {locale === "en-US" ? (
              <PublishedEnglishSlideFrame
                slide={activePublishedSlide}
                alt={slideImageAlt}
                isFullscreen={isPptFullscreen}
              />
            ) : activePublishedSlide.imageUrl ? (
              <Image
                src={activePublishedSlide.imageUrl}
                alt={slideImageAlt}
                width={1467}
                height={825}
                sizes="(min-width: 1280px) 960px, 92vw"
                loading="eager"
                unoptimized
                className={
                  isPptFullscreen
                    ? "h-full max-h-screen w-full bg-black object-contain"
                    : "h-full w-full bg-white object-contain"
                }
              />
            ) : (
              <div
                className={
                  isPptFullscreen
                    ? "grid h-full w-full place-items-center bg-black px-6 text-center text-sm font-semibold text-white"
                    : "grid h-full w-full place-items-center bg-[#f8fbff] px-6 text-center text-sm font-semibold text-[#697089]"
                }
              >
                {locale === "zh-CN" ? "课件图片准备中" : "Slide image preparing"}
              </div>
            )}
          </figure>

          <div
            data-uais-learning-slide-count="stage-overlay"
            className="mt-3 text-right text-sm font-medium text-[#858ca4] xl:pointer-events-none xl:absolute xl:bottom-3 xl:right-5 xl:mt-0"
          >
            {activePublishedSlide.slideNumber} / {publishedPlayback.slideCount}
          </div>
        </div>

        <StudyActionBar
          locale={locale}
          conceptCount={conceptCount}
          compact
          onStudyAction={onStudyAction}
        />
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e2e6f0] bg-white shadow-[0_18px_44px_rgba(46,58,91,0.08)]">
      <div className="relative min-h-[470px] p-7 lg:p-9 xl:min-h-[555px]">
        {publishedPlaybackError ? (
          <div
            data-uais-learning-ppt-error={publishedPlaybackError}
            className={[
              "absolute right-7 top-7 rounded-full border px-3 py-1 text-sm font-semibold",
              publishedPlaybackError === "unavailable"
                ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1f6feb]"
                : "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]",
            ].join(" ")}
          >
            {getPublishedPlaybackErrorLabel(locale, publishedPlaybackError)}
          </div>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(310px,0.9fr)] lg:items-center">
          <div className="pt-14 lg:pt-20">
            <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-[#1f6feb] lg:text-[34px] xl:whitespace-nowrap">
              {locale === "zh-CN" ? "3.2  梯度下降算法" : "3.2 Gradient Descent"}
            </h1>

            <div className="mt-14 space-y-6 text-[#27304a]">
              <div>
                <p className="text-lg font-semibold text-[#1f6feb]">
                  {locale === "zh-CN" ? "目标：" : "Goal:"}
                  <span className="ml-2 font-medium text-[#252a40]">
                    {locale === "zh-CN" ? "最小化损失函数 J(θ)" : "Minimize loss function J(θ)"}
                  </span>
                </p>
                <p className="mt-5 max-w-md text-base leading-8">
                  {locale === "zh-CN"
                    ? "通过迭代更新参数向量 θ，沿着负梯度方向逐步逼近最优解。"
                    : "Iteratively update parameter vector θ along the negative gradient toward an optimum."}
                </p>
              </div>

              <div>
                <p className="text-lg font-semibold text-[#1f6feb]">
                  {locale === "zh-CN" ? "更新公式：" : "Update:"}
                </p>
                <div className="mt-3 inline-flex rounded-xl border border-[#bfdbfe] bg-[#f8fbff] px-5 py-3 font-serif text-xl text-[#222842] shadow-[0_8px_18px_rgba(31,111,235,0.08)]">
                  θ(t+1) = θ(t) - η∇J(θ(t))
                </div>
              </div>

              <ul className="space-y-3 text-base leading-7 text-[#303650]">
                <li>• θ：{locale === "zh-CN" ? "参数向量" : "parameter vector"}</li>
                <li>• η：{locale === "zh-CN" ? "学习率（Learning Rate）" : "learning rate"}</li>
                <li>• ∇J(θ)：{locale === "zh-CN" ? "损失函数的梯度" : "gradient of the loss"}</li>
              </ul>
            </div>
          </div>

          <GradientDescentDiagram locale={locale} />
        </div>

        <div className="absolute bottom-8 right-8 text-lg font-medium text-[#858ca4]">30 / 68</div>
      </div>

      <StudyActionBar
        locale={locale}
        conceptCount={conceptCount}
        onStudyAction={onStudyAction}
      />
    </section>
  );
}

function PublishedEnglishSlideFrame({
  slide,
  alt,
  isFullscreen,
}: {
  slide: LearningPptPlaybackSlide;
  alt: string;
  isFullscreen: boolean;
}) {
  const narrativePoints = getEnglishSlideNarrativePoints(slide.narrationText);
  const slideNumber = String(slide.slideNumber).padStart(2, "0");

  return (
    <div
      role="img"
      aria-label={alt}
      data-uais-english-slide="active"
      className={[
        "grid h-full w-full bg-white text-[#172033]",
        isFullscreen
          ? "max-h-screen max-w-[min(100vw,calc(100vh*16/9))] grid-rows-[auto_1fr_auto] p-10 sm:p-14"
          : "grid-rows-[auto_1fr_auto] p-5 sm:p-8 lg:p-10",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-[76%]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1f6feb]">
            Elementary Mathematics Research
          </p>
          <h2
            className={[
              "mt-3 font-semibold leading-tight text-[#172033]",
              isFullscreen ? "text-[clamp(2rem,4vw,4.75rem)]" : "text-[clamp(1.45rem,3vw,3.25rem)]",
            ].join(" ")}
          >
            {slide.slideTitle}
          </h2>
        </div>
        <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-[#1f6feb] text-xl font-semibold text-white shadow-[0_16px_34px_rgba(31,111,235,0.22)]">
          {slideNumber}
        </div>
      </div>

      <div className="grid content-center gap-4">
        {narrativePoints.map((point, index) => (
          <div
            key={`${slide.slideId}-english-point-${index}`}
            className="grid grid-cols-[34px_minmax(0,1fr)] gap-4 rounded-2xl border border-[#dbeafe] bg-[#f8fbff] p-4 text-left shadow-[0_10px_26px_rgba(31,111,235,0.08)]"
          >
            <span className="grid size-8 place-items-center rounded-full bg-white text-sm font-semibold text-[#1f6feb] shadow-[0_6px_14px_rgba(31,111,235,0.12)]">
              {index + 1}
            </span>
            <p className="text-sm font-medium leading-6 text-[#303650] sm:text-base">
              {point}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[#e2e8f0] pt-4 text-sm font-semibold text-[#5d657d]">
        <span>Dr. Kang Xia</span>
        <span>Slide {slide.slideNumber}</span>
      </div>
    </div>
  );
}

function getEnglishSlideNarrativePoints(narrationText: string) {
  const sentences = narrationText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.slice(0, 3).length > 0
    ? sentences.slice(0, 3)
    : ["Review the slide title, key idea, and teaching implication."];
}

function StudyActionBar({
  locale,
  conceptCount,
  compact = false,
  onStudyAction,
}: {
  locale: Locale;
  conceptCount: number;
  compact?: boolean;
  onStudyAction: (action: StudyAction) => void;
}) {
  const zh = locale === "zh-CN";
  const actions = [
    { action: "ask" as const, label: zh ? "问这页" : "Ask", icon: ChatTeardropText },
    { action: "notes" as const, label: zh ? "生成笔记" : "Notes", icon: Notebook },
    { action: "checkpoint" as const, label: zh ? "学习检查点" : "Checkpoint", icon: Target },
    {
      action: "concepts" as const,
      label: zh ? "关键概念" : "Concepts",
      icon: Sparkle,
      badge: String(conceptCount),
    },
    { action: "export" as const, label: zh ? "导出笔记" : "Export", icon: FilePdf },
  ];

  return (
    <div
      data-uais-learning-study-actions={compact ? "compact" : "standard"}
      className={[
        "grid border-t border-[#eceff6] bg-[#fbfcff] sm:grid-cols-5",
        compact ? "gap-2 p-3 xl:grid-cols-5" : "gap-3 p-4",
      ].join(" ")}
    >
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.action}
            type="button"
            aria-label={action.label}
            onClick={() => onStudyAction(action.action)}
            className={[
              "relative inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-[#e0e4ee] bg-white px-3 text-sm font-semibold text-[#49506a] outline-none transition hover:border-[#1f6feb] hover:text-[#1f6feb] focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
              compact ? "h-10" : "h-11",
            ].join(" ")}
          >
            <Icon size={17} weight="duotone" />
            {action.label}
            {action.badge ? (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-2 flex size-5 items-center justify-center rounded-full bg-[#60a5fa] text-[11px] text-white"
              >
                {action.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function GradientDescentDiagram({ locale }: { locale: Locale }) {
  return (
    <div className="relative min-h-[330px]">
      <div className="absolute inset-x-4 bottom-4 h-28 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(31,111,235,0.18),rgba(31,111,235,0.04)_58%,transparent_72%)]" />
      <div className="absolute left-1/2 top-8 h-64 w-72 -translate-x-1/2 rounded-[52%_52%_42%_42%] bg-[radial-gradient(circle_at_50%_72%,#1557c0_0%,#3b82f6_24%,#bfdbfe_52%,#eff6ff_100%)] opacity-95 shadow-[0_28px_46px_rgba(31,111,235,0.28)] [clip-path:ellipse(50%_45%_at_50%_54%)]" />
      <div className="absolute left-1/2 top-10 h-64 w-72 -translate-x-1/2 rounded-[52%] bg-[repeating-linear-gradient(72deg,transparent_0,transparent_15px,rgba(255,255,255,0.35)_16px),repeating-linear-gradient(156deg,transparent_0,transparent_18px,rgba(74,63,177,0.18)_19px)] opacity-70 [clip-path:ellipse(50%_45%_at_50%_54%)]" />
      <div className="absolute left-[22%] bottom-14 h-px w-[58%] rotate-[21deg] bg-[#30364d]" />
      <div className="absolute left-[25%] bottom-14 h-px w-[45%] -rotate-[33deg] bg-[#30364d]" />
      <div className="absolute left-[27%] bottom-14 h-40 w-px bg-[#30364d]" />
      <span className="absolute left-[28%] top-28 text-sm font-medium text-[#30364d]">J(θ)</span>
      <span className="absolute bottom-4 left-[38%] text-sm font-medium text-[#30364d]">θ1</span>
      <span className="absolute bottom-8 right-[18%] text-sm font-medium text-[#30364d]">θ2</span>
      <div className="absolute left-[53%] top-[26%] h-40 w-1 origin-bottom rotate-[24deg] rounded-full bg-[#0f3f96]">
        {[0, 1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className="absolute left-1/2 size-3 -translate-x-1/2 rounded-full bg-[#0b2f6b] ring-2 ring-white"
            style={{ top: `${step * 17}%` }}
          />
        ))}
      </div>
      <span className="absolute right-8 top-20 rounded-lg border border-[#bfdbfe] bg-white px-3 py-2 text-xs font-semibold text-[#1e3a5f] shadow-[0_8px_18px_rgba(31,78,121,0.1)]">
        {locale === "zh-CN" ? "起点（随机初始化）" : "Start"}
      </span>
      <span className="absolute bottom-10 right-12 rounded-lg border border-[#bfdbfe] bg-white px-3 py-2 text-xs font-semibold text-[#1e3a5f] shadow-[0_8px_18px_rgba(31,78,121,0.1)]">
        {locale === "zh-CN" ? "收敛到最优解" : "Converges"}
      </span>
    </div>
  );
}

const NARRATION_PLAYBACK_RATES = [1.25, 1, 0.85] as const;

function getNarrationPlaybackRateIndex(speed: string) {
  const rate = Number(speed.match(/\d+(?:\.\d+)?/)?.[0]);
  const index = NARRATION_PLAYBACK_RATES.findIndex(
    (playbackRate) => Math.abs(playbackRate - rate) < 0.001,
  );
  return index >= 0 ? index : 0;
}

function formatNarrationPlaybackRate(rate: number, locale: Locale) {
  const value = rate === 1 ? "1" : String(rate);
  return locale === "zh-CN" ? `${value} 倍` : `${value}x`;
}

function NarrationDock({
  locale,
  playback,
  publishedPlayback,
  activePublishedSlide,
  activePublishedSlideIndex,
  onPreviousPublishedSlide,
  onNextPublishedSlide,
  studyToolsOpen,
  onOpenStudyTools,
}: {
  locale: Locale;
  playback: PlaybackContent;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
  activePublishedSlideIndex: number;
  onPreviousPublishedSlide: () => void;
  onNextPublishedSlide: () => void;
  studyToolsOpen: boolean;
  onOpenStudyTools: () => void;
}) {
  const publishedSlideCount = publishedPlayback?.slides.length ?? 0;
  const canShowPrevious = publishedSlideCount > 0 && activePublishedSlideIndex > 0;
  const canShowNext =
    publishedSlideCount > 0 && activePublishedSlideIndex < publishedSlideCount - 1;
  const [speakingSlideId, setSpeakingSlideId] = useState<string>();
  const [isFallbackNarrationPlaying, setIsFallbackNarrationPlaying] = useState(false);
  const [narrationProgress, setNarrationProgress] = useState({
    slideId: "",
    currentTime: 0,
  });
  const [isNarrationMuted, setIsNarrationMuted] = useState(false);
  const [narrationPlaybackRateState, setNarrationPlaybackRateState] = useState(() => ({
    sourceSpeed: playback.speed,
    index: getNarrationPlaybackRateIndex(playback.speed),
  }));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const narrationPlaybackRateIndex =
    narrationPlaybackRateState.sourceSpeed === playback.speed
      ? narrationPlaybackRateState.index
      : getNarrationPlaybackRateIndex(playback.speed);
  const narrationPlaybackRate =
    NARRATION_PLAYBACK_RATES[narrationPlaybackRateIndex] ?? NARRATION_PLAYBACK_RATES[0];
  const narrationSpeedLabel = formatNarrationPlaybackRate(narrationPlaybackRate, locale);
  const narrationSpeedTitle =
    locale === "zh-CN"
      ? `切换语音速度（当前 ${narrationSpeedLabel}）`
      : `Switch narration speed (current ${narrationSpeedLabel})`;
  const isPublishedNarrationPlaying = Boolean(
    activePublishedSlide && speakingSlideId === activePublishedSlide.slideId,
  );
  const isNarrationPlaying = publishedPlayback
    ? isPublishedNarrationPlaying
    : isFallbackNarrationPlaying;
  const isTeacherSpeaking = isPublishedNarrationPlaying;
  const primaryNarrationLabel = isNarrationPlaying
    ? locale === "zh-CN"
      ? "暂停讲解"
      : "Pause narration"
    : locale === "zh-CN"
      ? "播放讲解"
      : "Play narration";
  const narrationDuration = activePublishedSlide?.durationSeconds ?? 0;
  const narrationCurrentTime =
    activePublishedSlide && narrationProgress.slideId === activePublishedSlide.slideId
      ? Math.min(narrationProgress.currentTime, narrationDuration)
      : 0;
  const teacherAvatarProgress =
    narrationDuration > 0
      ? Math.min(100, Math.max(0, (narrationCurrentTime / narrationDuration) * 100))
      : 0;
  const teacherAvatarProgressPercent = Math.round(teacherAvatarProgress);
  const narrationTimeText = `${formatNarrationTime(narrationCurrentTime)} / ${formatNarrationTime(narrationDuration)}`;
  const muteLabel = isNarrationMuted
    ? locale === "zh-CN"
      ? "恢复音量"
      : "Restore volume"
    : locale === "zh-CN"
      ? "静音讲解"
      : "Mute narration";

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = narrationPlaybackRate;
    }
  }, [activePublishedSlide?.slideId, narrationPlaybackRate]);

  function handlePrimaryNarrationToggle() {
    if (!publishedPlayback || !activePublishedSlide) {
      setIsFallbackNarrationPlaying((current) => !current);
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (isNarrationPlaying) {
      audio.pause();
      return;
    }

    setSpeakingSlideId(activePublishedSlide.slideId);
    void audio.play().catch(() => {
      setSpeakingSlideId(undefined);
    });
  }

  function handleNarrationProgressChange(event: ChangeEvent<HTMLInputElement>) {
    if (!activePublishedSlide) {
      return;
    }

    const nextTime = Number(event.currentTarget.value);
    const audio = audioRef.current;
    if (audio && Number.isFinite(nextTime)) {
      audio.currentTime = nextTime;
    }
    setNarrationProgress({
      slideId: activePublishedSlide.slideId,
      currentTime: Number.isFinite(nextTime) ? nextTime : 0,
    });
  }

  function handleNarrationSpeedToggle() {
    const nextIndex = (narrationPlaybackRateIndex + 1) % NARRATION_PLAYBACK_RATES.length;
    const nextRate = NARRATION_PLAYBACK_RATES[nextIndex];
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = nextRate;
    }
    setNarrationPlaybackRateState({
      sourceSpeed: playback.speed,
      index: nextIndex,
    });
  }

  function syncNarrationProgress() {
    const audio = audioRef.current;
    if (!audio || !activePublishedSlide) {
      return;
    }

    setNarrationProgress({
      slideId: activePublishedSlide.slideId,
      currentTime: audio.currentTime,
    });
  }

  function handleNarrationMuteToggle() {
    const audio = audioRef.current;
    const nextMuted = !isNarrationMuted;
    if (audio) {
      audio.muted = nextMuted;
    }
    setIsNarrationMuted(nextMuted);
  }

  return (
    <section
      data-uais-learning-narration-dock="compact"
      className="mt-10 min-w-0 w-full rounded-2xl border border-[#e2e6f0] bg-white p-3 shadow-[0_18px_44px_rgba(46,58,91,0.08)] xl:mt-20 xl:min-h-0"
    >
      <div
        data-uais-learning-narration-dock-layout="desktop"
        className="grid gap-3 xl:grid-cols-[220px_minmax(340px,440px)_minmax(300px,1fr)] xl:items-center xl:gap-4"
      >
        <div
          data-uais-learning-narration-profile={
            publishedPlayback ? "published-teacher" : "fallback-teacher"
          }
          className="flex min-w-0 items-center gap-3"
        >
          <span
            data-uais-teacher-avatar={publishedPlayback ? "published-narration" : undefined}
            data-uais-teacher-avatar-progress={
              publishedPlayback ? "slide-playback" : undefined
            }
            data-progress-percent={
              publishedPlayback ? teacherAvatarProgressPercent : undefined
            }
            data-speaking={publishedPlayback ? String(isTeacherSpeaking) : undefined}
            role={publishedPlayback ? "progressbar" : undefined}
            aria-label={
              publishedPlayback
                ? locale === "zh-CN"
                  ? "当前课件播放进度"
                  : "Current slide playback progress"
                : undefined
            }
            aria-valuemin={publishedPlayback ? 0 : undefined}
            aria-valuemax={publishedPlayback ? 100 : undefined}
            aria-valuenow={publishedPlayback ? teacherAvatarProgressPercent : undefined}
            aria-valuetext={publishedPlayback ? narrationTimeText : undefined}
            style={
              publishedPlayback
                ? {
                    background: `conic-gradient(from 0deg, #1f6feb ${teacherAvatarProgress}%, #dbeafe ${teacherAvatarProgress}% 100%)`,
                  }
                : undefined
            }
            className={[
              "grid size-18 shrink-0 place-items-center rounded-full p-1 text-lg font-semibold text-[#1f6feb] transition-[background] duration-200",
              publishedPlayback ? "shadow-[0_0_0_3px_rgba(219,234,254,0.55)]" : "bg-[linear-gradient(135deg,#eff6ff,#dbeafe)]",
            ].join(" ")}
          >
            <span className="grid size-16 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#eff6ff,#dbeafe)] ring-2 ring-white">
              {publishedPlayback ? (
                <Image
                  src="/learning/teacher-avatar-kang-xia-comic.png"
                  alt={
                    locale === "zh-CN"
                      ? `${publishedPlayback.teacherName}教师头像`
                      : `${publishedPlayback.teacherName} teacher avatar`
                  }
                  width={72}
                  height={72}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                "李"
              )}
            </span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-[#222842]">
              {publishedPlayback?.teacherName ??
                (locale === "zh-CN" ? "李明远 教授" : "Prof. Li Mingyuan")}
            </p>
            <p className="mt-1 truncate text-base text-[#697089]">
              {publishedPlayback?.courseTitle ??
                (locale === "zh-CN" ? "机器学习导论" : "Machine Learning")}
            </p>
          </div>
        </div>

        <div>
          {publishedPlayback && activePublishedSlide ? (
            <div>
              <audio
                ref={audioRef}
                data-uais-learning-ppt-audio="active-slide"
                className="sr-only"
                preload="metadata"
                src={activePublishedSlide.audioUrl}
                onPlay={() => {
                  setSpeakingSlideId(activePublishedSlide.slideId);
                }}
                onPause={() => {
                  setSpeakingSlideId(undefined);
                }}
                onEnded={() => {
                  setSpeakingSlideId(undefined);
                  syncNarrationProgress();
                }}
                onTimeUpdate={syncNarrationProgress}
                onLoadedMetadata={syncNarrationProgress}
                onVolumeChange={(event) => {
                  setIsNarrationMuted(event.currentTarget.muted);
                }}
              />
              <div
                data-uais-learning-audio-controls="custom"
                className="grid gap-2 rounded-2xl border border-[#e4e8f2] bg-[#f4f6fb] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] sm:grid-cols-[44px_104px_minmax(160px,520px)_40px] sm:items-center sm:justify-start sm:gap-3"
              >
                <button
                  type="button"
                  onClick={handlePrimaryNarrationToggle}
                  aria-pressed={isNarrationPlaying}
                  className="grid size-11 place-items-center rounded-full bg-[#1f6feb] text-white shadow-[0_14px_28px_rgba(31,111,235,0.24)] outline-none transition hover:bg-[#1759c8] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1f6feb] focus-visible:ring-offset-2"
                  aria-label={primaryNarrationLabel}
                  title={primaryNarrationLabel}
                >
                  {isNarrationPlaying ? (
                    <PauseCircle size={28} weight="fill" />
                  ) : (
                    <PlayCircle size={28} weight="fill" />
                  )}
                </button>
                <span
                  data-uais-learning-audio-time="elapsed"
                  className="min-w-[92px] text-left text-sm font-semibold tabular-nums text-[#252a40] sm:text-center"
                >
                  {narrationTimeText}
                </span>
                <div
                  data-uais-learning-audio-progress="rail"
                  className="min-w-0 max-w-[520px]"
                >
                  <input
                    type="range"
                    aria-label={locale === "zh-CN" ? "讲解进度" : "Narration progress"}
                    min={0}
                    max={narrationDuration}
                    step={0.1}
                    value={narrationCurrentTime}
                    onChange={handleNarrationProgressChange}
                    className="h-2 w-full cursor-pointer accent-[#1f6feb]"
                  />
                </div>
                <button
                  type="button"
                  aria-label={muteLabel}
                  title={muteLabel}
                  onClick={handleNarrationMuteToggle}
                  className="grid size-10 place-items-center rounded-full text-[#141833] outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
                >
                  {isNarrationMuted ? (
                    <SpeakerSlash size={23} weight="bold" />
                  ) : (
                    <SpeakerHigh size={23} weight="bold" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex h-16 items-center gap-1 overflow-hidden">
                {[18, 32, 45, 58, 38, 64, 78, 42, 54, 70, 86, 48, 63, 74, 92, 56, 38, 28, 20, 18, 16, 14].map(
                  (height, index) => (
                    <span
                      key={`${height}-${index}`}
                      className={index < 15 ? "w-1.5 rounded-full bg-[#1f6feb]" : "w-1.5 rounded-full bg-[#dfe3ee]"}
                      style={{ height }}
                    />
                  ),
                )}
              </div>
              <p className="text-center text-sm text-[#858ca4]">{locale === "zh-CN" ? "12:45 / 35:20" : "12:45 / 35:20"}</p>
            </>
          )}
        </div>

        <div
          data-uais-learning-segment-controls="compact"
          className="grid min-w-0 grid-cols-[36px_36px_1px_72px_minmax(140px,1fr)] items-center justify-end gap-2 sm:pl-4"
        >
          <button
            type="button"
            onClick={onPreviousPublishedSlide}
            disabled={!canShowPrevious}
            className={[
              "grid size-9 place-items-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
              canShowPrevious
                ? "border-[#e1e5ef] bg-white text-[#252a40] hover:border-[#1f6feb] hover:text-[#1f6feb]"
                : "cursor-not-allowed border-[#e6e9f2] bg-[#f4f6fb] text-[#a5abc0]",
            ].join(" ")}
            aria-label={locale === "zh-CN" ? "上一段" : "Previous"}
          >
            <CaretLeft size={18} weight="bold" />
          </button>
          <button
            type="button"
            onClick={onNextPublishedSlide}
            disabled={!canShowNext}
            className={[
              "grid size-9 place-items-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
              canShowNext
                ? "border-[#e1e5ef] bg-white text-[#252a40] hover:border-[#1f6feb] hover:text-[#1f6feb]"
                : "cursor-not-allowed border-[#e6e9f2] bg-[#f4f6fb] text-[#a5abc0]",
            ].join(" ")}
            aria-label={locale === "zh-CN" ? "下一段" : "Next"}
          >
            <CaretRight size={18} weight="bold" />
          </button>
          <span className="h-9 w-px bg-[#e4e7f0]" />
          <button
            className="inline-flex h-9 items-center justify-center rounded-lg border border-[#e1e5ef] bg-white px-2 text-sm font-semibold text-[#3d435a] outline-none transition hover:border-[#1f6feb] hover:text-[#1f6feb] focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
            type="button"
            onClick={handleNarrationSpeedToggle}
            aria-label={narrationSpeedTitle}
            title={narrationSpeedTitle}
          >
            {narrationSpeedLabel}
          </button>
          <button
            type="button"
            aria-label={locale === "zh-CN" ? "学习工具" : "Study Tools"}
            aria-controls="learning-tools-panel"
            aria-expanded={studyToolsOpen}
            title={locale === "zh-CN" ? "学习工具" : "Study Tools"}
            onClick={onOpenStudyTools}
            className={[
              "inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
              studyToolsOpen
                ? "border-[#bfdbfe] bg-[#eff6ff] text-[#1f6feb]"
                : "border-[#e1e5ef] bg-white text-[#4f5670] hover:border-[#bfdbfe] hover:text-[#1f6feb]",
            ].join(" ")}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <GearSix size={17} weight="duotone" className="shrink-0" />
              <span className="truncate">{locale === "zh-CN" ? "学习工具" : "Study Tools"}</span>
            </span>
            <span
              aria-hidden="true"
              className="hidden min-w-0 truncate text-xs font-medium text-[#7b8399] min-[1440px]:inline"
            >
              {locale === "zh-CN" ? "本页笔记 · 检查点 · 概念卡" : "Notes · Check · Concepts"}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

function formatNarrationTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const roundedSeconds = Math.round(safeSeconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = String(roundedSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
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

function StudyToolsPanel({
  locale,
  studyContent,
  activeView,
  expandedCheckpointId,
  onToggleCheckpoint,
  onActiveViewChange,
  onClose,
}: {
  locale: Locale;
  studyContent: SlideStudyContent;
  activeView: StudyToolView;
  expandedCheckpointId?: string;
  onToggleCheckpoint: (checkpointId: string) => void;
  onActiveViewChange: (view: StudyToolView) => void;
  onClose: () => void;
}) {
  const zh = locale === "zh-CN";
  const toolTabs = [
    { view: "notes" as const, label: zh ? "本页笔记" : "Slide Notes", icon: Notebook },
    { view: "checkpoint" as const, label: zh ? "检查点" : "Check", icon: Target },
    { view: "concepts" as const, label: zh ? "概念卡" : "Concept Cards", icon: Sparkle },
  ];

  return (
    <>
      <button
        type="button"
        aria-label={zh ? "关闭学习工具背景" : "Close study tools backdrop"}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-[#141833]/35 backdrop-blur-[1px] xl:hidden"
      />
      <section
        id="learning-tools-panel"
        role="dialog"
        aria-label={zh ? "学习工具" : "Study Tools"}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-hidden rounded-t-2xl border border-[#dfe4ef] bg-white shadow-[0_-22px_48px_rgba(20,24,51,0.18)] xl:static xl:z-auto xl:max-h-none xl:rounded-none xl:border-0 xl:bg-transparent xl:shadow-none"
      >
        <div className="border-b border-[#e9ecf4] bg-white p-4 xl:bg-transparent xl:px-0 xl:pt-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f6feb]">
                <GearSix size={17} weight="duotone" />
                {zh ? "学习工具" : "Study Tools"}
              </p>
              <p className="mt-1 truncate text-xs font-medium text-[#7b8399]">
                {zh ? "记录、检查和复习当前页" : "Capture, check, and review this slide"}
              </p>
            </div>
            <button
              type="button"
              aria-label={zh ? "关闭学习工具" : "Close study tools"}
              onClick={onClose}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-[#e1e5ef] bg-white text-[#5e667f] outline-none transition hover:border-[#bfdbfe] hover:text-[#1f6feb] focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
            >
              <X size={17} weight="bold" />
            </button>
          </div>

          <div
            role="group"
            aria-label={zh ? "学习工具栏目切换" : "Study tools switcher"}
            className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-[#dfe4ef] bg-[#f7f9fd] p-1"
          >
            {toolTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeView === tab.view;
              return (
                <button
                  key={tab.view}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onActiveViewChange(tab.view)}
                  className={[
                    "inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#1f6feb]",
                    active
                      ? "border-[#1f6feb] bg-[#1f6feb] text-white shadow-[0_8px_18px_rgba(31,111,235,0.2)]"
                      : "border-transparent bg-white text-[#4f5670] hover:border-[#bfdbfe] hover:text-[#1f6feb]",
                  ].join(" ")}
                >
                  <Icon size={16} weight="duotone" className="shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-h-[calc(82dvh-8rem)] overflow-y-auto p-4 xl:max-h-none xl:p-0 xl:pt-4">
          {activeView === "notes" ? (
            <SlideNotesView locale={locale} studyContent={studyContent} />
          ) : null}

          {activeView === "checkpoint" ? (
            <StudyCheckpointView
              locale={locale}
              studyContent={studyContent}
              expandedCheckpointId={expandedCheckpointId}
              onToggleCheckpoint={onToggleCheckpoint}
            />
          ) : null}

          {activeView === "concepts" ? (
            <SlideConceptsView locale={locale} studyContent={studyContent} />
          ) : null}
        </div>
      </section>
    </>
  );
}

function SlideNotesView({
  locale,
  studyContent,
}: {
  locale: Locale;
  studyContent: SlideStudyContent;
}) {
  const zh = locale === "zh-CN";

  return (
    <section>
      <div className="rounded-xl border border-[#dfe7f6] bg-[#f8fbff] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#1f6feb]">
          {studyContent.slideLabel}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-[#222842]">
          {zh ? "本页笔记" : "Slide Notes"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#5d657d]">{studyContent.slideTitle}</p>
      </div>

      <div className="mt-4 space-y-4">
        <section className="rounded-xl border border-[#e4e8f2] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#303650]">
            {zh ? "学习要点" : "Study Takeaways"}
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[#535b76]">
            {studyContent.takeaways.map((takeaway) => (
              <li key={takeaway} className="flex gap-2">
                <CheckCircle size={17} weight="duotone" className="mt-1 shrink-0 text-[#1f6feb]" />
                <span>{takeaway}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-[#e4e8f2] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#303650]">
            {zh ? "讲解线索" : "Narration Cue"}
          </h3>
          <p className="mt-3 text-sm leading-6 text-[#535b76]">{studyContent.narrationCue}</p>
        </section>
      </div>
    </section>
  );
}

function StudyCheckpointView({
  locale,
  studyContent,
  expandedCheckpointId,
  onToggleCheckpoint,
}: {
  locale: Locale;
  studyContent: SlideStudyContent;
  expandedCheckpointId?: string;
  onToggleCheckpoint: (checkpointId: string) => void;
}) {
  const zh = locale === "zh-CN";

  return (
    <section>
      <h2 className="text-lg font-semibold text-[#222842]">
        {zh ? "学习检查点" : "Study Checkpoint"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#697089]">
        {zh
          ? `围绕「${studyContent.slideTitle}」完成自检。`
          : `Check your understanding of "${studyContent.slideTitle}".`}
      </p>
      <div className="mt-4 space-y-3">
        {studyContent.checkpoints.map((checkpoint) => {
          const expanded = expandedCheckpointId === checkpoint.id;
          return (
            <div key={checkpoint.id} className="rounded-xl border border-[#e4e8f2] bg-white">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => onToggleCheckpoint(checkpoint.id)}
                className="flex w-full items-start justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold leading-6 text-[#303650] outline-none transition hover:bg-[#f8fbff] focus-visible:ring-2 focus-visible:ring-[#1f6feb]"
              >
                <span>{checkpoint.question}</span>
                <CaretRight
                  size={17}
                  weight="bold"
                  className={[
                    "mt-1 shrink-0 text-[#1f6feb] transition",
                    expanded ? "rotate-90" : "",
                  ].join(" ")}
                />
              </button>
              {expanded ? (
                <div className="border-t border-[#edf0f6] px-4 py-3 text-sm leading-6 text-[#535b76]">
                  <p className="font-semibold text-[#1f6feb]">
                    {zh ? "参考答案" : "Suggested Answer"}
                  </p>
                  <p className="mt-2">{checkpoint.answer}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SlideConceptsView({
  locale,
  studyContent,
}: {
  locale: Locale;
  studyContent: SlideStudyContent;
}) {
  const zh = locale === "zh-CN";

  return (
    <section>
      <h2 className="text-lg font-semibold text-[#222842]">
        {zh ? "关键概念" : "Key Concepts"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#697089]">
        {zh
          ? `本页共有 ${studyContent.concepts.length} 个概念需要钉住。`
          : `${studyContent.concepts.length} concepts are pinned for this slide.`}
      </p>
      <div className="mt-4 space-y-3">
        {studyContent.concepts.map((concept) => (
          <article
            key={concept.title}
            className="rounded-xl border border-[#e4e8f2] bg-white p-4 shadow-[0_8px_18px_rgba(46,58,91,0.04)]"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#dbeafe] text-[#1f6feb]">
                <Sparkle size={18} weight="duotone" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#303650]">{concept.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#535b76]">{concept.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
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
