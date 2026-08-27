"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { ChatsCircle } from "@phosphor-icons/react/dist/ssr/ChatsCircle";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { PlayCircle } from "@phosphor-icons/react/dist/ssr/PlayCircle";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { useSessionUser } from "@/components/providers/session-user";
import { copy, type Locale } from "@/i18n/copy";
import {
  createLearningReturnPath,
  createLoginHandoffHref,
} from "@/lib/auth/login-return-path";
import {
  createUniqueLearningEventKey,
  reportLearningEvent,
} from "@/lib/learning-records/client-event-reporter";
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
  createCompletedNarrationStorageKey,
  createSlideStudyContent,
  exportSlideStudyNotes,
  formatSlideDurationLabel,
  getPlaybackContent,
  readCompletedNarrationSlideIds,
  resolveLearningEventCourseId,
  type SlideStudyContent,
  type StudyAction,
  type StudyToolView,
} from "./learning-page-helpers";
import { usePublishedLearningPlayback } from "./learning-page-published-playback";
import { PptStage, SlideChapterRail } from "./learning-page-slides";
import { NarrationDock } from "./learning-page-narration";
import { StudyToolsPanel } from "./learning-page-study-tools";
import { LangGraphTracePanel } from "./learning-page-trace-panel";
import { LearningPracticePanel } from "./learning-practice-panel";

const playbackJumpLinkClassName =
  "inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:border-[var(--accent-border)] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

type PrimaryCompanionView = "ai" | "subtitles" | "outline" | "practice";

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
  const sessionUser = useSessionUser();
  const learnerAccount =
    sessionUser?.role === "student" ? sessionUser.account : undefined;
  const t = copy[locale];
  const selectedCourseId = getValidatedCourseId(initialCourseId);
  const playback = getPlaybackContent(selectedCourseId, locale);
  const playbackCourseId = initialCourseId ?? publishedLearningPptCourseId;
  const {
    publishedPlayback,
    publishedPlaybackError,
    isPublishedPlaybackLoading,
    activePublishedSlide,
    activePublishedSlideIndex,
    setActivePublishedSlideIndex,
    retryPublishedPlayback,
  } = usePublishedLearningPlayback({ courseId: playbackCourseId, locale });
  const [approvedInviteLearningContext, setApprovedInviteLearningContext] =
    useState<ApprovedInviteLearningContext>();
  const [activeCompanionView, setActiveCompanionView] = useState<CompanionView>("ai");
  const [studyToolsOpen, setStudyToolsOpen] = useState(false);
  const [guideDraft, setGuideDraft] = useState("");
  const [guideFocusSequence, setGuideFocusSequence] = useState(0);
  const completedNarrationSlideIdsRef = useRef(new Set<string>());
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
      const eventCourseId = resolveLearningEventCourseId({
        publishedPlaybackCourseId: publishedPlayback?.courseId,
        selectedCourseId,
        approvedMembershipCourseId: visibleApprovedInviteLearningContext?.courseId,
      });
      // The export itself always runs; only its learning record is conditional.
      // A student browsing the template's sample deck still gets their notes.
      if (learnerAccount && eventCourseId) {
        void reportLearningEvent({
          actorId: learnerAccount,
          event: {
            type: "activity.attempted",
            object: {
              id: `${eventCourseId}/slides/${activePublishedSlide?.slideId ?? "overview"}/study-notes-export`,
              name: `Study notes · ${studyContent.slideTitle}`,
            },
            context: {
              courseId: eventCourseId,
              classId: approvedClassIdForCourse(eventCourseId),
              lessonId: publishedPlayback?.audioManifestId,
              locale,
            },
          },
        });
      }
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
    // A course or locale switch starts a new deck. Do not carry a narration
    // dedupe key into another manifest; persistent progress is read separately.
    completedNarrationSlideIdsRef.current = new Set<string>();
  }, [locale, playbackCourseId]);

  const visibleApprovedInviteLearningContext =
    approvedInviteLearningContext?.courseId === initialCourseId &&
    approvedInviteLearningContext?.classId === initialClassId
      ? approvedInviteLearningContext
      : undefined;

  function approvedClassIdForCourse(eventCourseId: string) {
    // The approved invite context belongs to the URL's course; never stamp its
    // classId onto statements about a different course.
    return visibleApprovedInviteLearningContext?.courseId === eventCourseId
      ? visibleApprovedInviteLearningContext.classId
      : undefined;
  }

  function createSlideNarrationEventBase(slide: LearningPptPlaybackSlide) {
    if (!learnerAccount || !publishedPlayback) {
      return undefined;
    }
    return {
      objectId: `${publishedPlayback.courseId}/ppt-playback/${publishedPlayback.audioManifestId}/slides/${slide.slideId}`,
      objectName: `${publishedPlayback.courseTitle} · ${slide.slideTitle} narration`,
      context: {
        courseId: publishedPlayback.courseId,
        classId: approvedClassIdForCourse(publishedPlayback.courseId),
        lessonId: publishedPlayback.audioManifestId,
        locale,
      },
    };
  }

  function mergeCompletedNarrationSlideIds(slideId: string) {
    // Completion progress is keyed per learner/course/manifest and persisted in
    // localStorage so finishing a course across several visits still yields
    // course.completed (device-scoped; the LRS write itself dedupes globally).
    if (!learnerAccount || !publishedPlayback) {
      return completedNarrationSlideIdsRef.current;
    }
    const storageKey = createCompletedNarrationStorageKey({
      learnerAccount,
      courseId: publishedPlayback.courseId,
      audioManifestId: publishedPlayback.audioManifestId,
    });
    const completedSlideIds = new Set(completedNarrationSlideIdsRef.current);
    for (const storedSlideId of readCompletedNarrationSlideIds(storageKey)) {
      completedSlideIds.add(storedSlideId);
    }
    completedSlideIds.add(slideId);
    completedNarrationSlideIdsRef.current = completedSlideIds;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...completedSlideIds]));
    } catch {
      // Best effort only.
    }
    return completedSlideIds;
  }

  function handleSlideNarrationPlay(slide: LearningPptPlaybackSlide) {
    const base = createSlideNarrationEventBase(slide);
    if (!learnerAccount || !base) {
      return;
    }
    void reportLearningEvent({
      actorId: learnerAccount,
      event: {
        type: "activity.attempted",
        object: { id: base.objectId, name: base.objectName },
        context: base.context,
      },
      idempotencyKey: [
        learnerAccount,
        "activity.attempted",
        base.context.courseId,
        base.objectId,
        "narration-started",
      ].join(":"),
    });
  }

  function handleSlideNarrationEnded(slide: LearningPptPlaybackSlide) {
    const base = createSlideNarrationEventBase(slide);
    if (!learnerAccount || !base || !publishedPlayback) {
      return;
    }
    const roundedDurationSeconds = Math.round(slide.durationSeconds);
    void reportLearningEvent({
      actorId: learnerAccount,
      event: {
        type: "activity.attempted",
        object: { id: base.objectId, name: base.objectName },
        // No result.completion here: a finished SLIDE narration must not mark
        // the whole lesson complete in learner profiles (see commit 412a52c);
        // lesson/course completion is only the all-slides signal below.
        ...(Number.isFinite(roundedDurationSeconds) && roundedDurationSeconds > 0
          ? { result: { duration: `PT${roundedDurationSeconds}S` } }
          : {}),
        context: base.context,
      },
      idempotencyKey: [
        learnerAccount,
        "activity.attempted",
        base.context.courseId,
        base.objectId,
        "narration-completed",
      ].join(":"),
    });

    // Genuine completion signal: the learner finished the narration of every
    // slide in the published manifest (a manifest view alone is never enough —
    // see commit 412a52c).
    const completedSlideIds = mergeCompletedNarrationSlideIds(slide.slideId);
    const allSlideNarrationsCompleted = publishedPlayback.slides.every(
      (manifestSlide) => completedSlideIds.has(manifestSlide.slideId),
    );
    if (allSlideNarrationsCompleted) {
      void reportLearningEvent({
        actorId: learnerAccount,
        event: {
          type: "course.completed",
          object: {
            id: publishedPlayback.courseId,
            name: publishedPlayback.courseTitle,
          },
          result: { completion: true },
          context: {
            courseId: publishedPlayback.courseId,
            classId: approvedClassIdForCourse(publishedPlayback.courseId),
            // Completing every slide narration completes this manifest's
            // lesson as well, so learner profiles see the lesson close out.
            lessonId: publishedPlayback.audioManifestId,
            locale,
          },
        },
      });
    }
  }
  const visibleCourseContextTitle = publishedPlayback
    ? `${locale === "zh-CN" ? "当前课程：" : "Current course: "}${publishedPlayback.courseTitle}`
    : playback.liveHint;
  const visibleCourseContextSlideTitle = activePublishedSlide?.slideTitle ?? playback.slideTitle;
  // A 401 on the deck used to render as a dead label. The return path is built
  // from the route's own props rather than `window.location`, so the href is the
  // same string on the server render and on the first client render.
  const playbackSignInHref = createLoginHandoffHref(
    createLearningReturnPath({ courseId: initialCourseId, classId: initialClassId }),
  );

  return (
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 bg-[var(--background)] px-3 py-3 text-[var(--foreground)] sm:px-4 lg:px-5">
      <div
        data-uais-learning-course-context="selected-course"
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm font-semibold text-[var(--foreground)]"
      >
        <span>{visibleCourseContextTitle}</span>
        <span className="text-[var(--placeholder)]">/</span>
        <span className="text-[var(--muted)]">{visibleCourseContextSlideTitle}</span>
        {visibleApprovedInviteLearningContext ? (
          <>
            <span className="text-[var(--placeholder)]">/</span>
            <span className="text-[var(--accent)]">
              {visibleApprovedInviteLearningContext.courseName}
            </span>
            <span className="text-[var(--muted)]">
              {visibleApprovedInviteLearningContext.className}
            </span>
            {visibleApprovedInviteLearningContext.semester ? (
              <span className="text-[var(--muted)]">
                {visibleApprovedInviteLearningContext.semester}
              </span>
            ) : null}
            <span className="rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">
              {locale === "zh-CN" ? "已通过邀请码加入" : "Joined by approved invite code"}
            </span>
          </>
        ) : null}
        <Link
          href="/learning/chatroom"
          className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-xs font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <ChatsCircle size={15} weight="duotone" aria-hidden="true" />
          {t.learning.openChatroom}
        </Link>
      </div>
      {/* Below `xl` the three columns stack, which used to bury the AI guide,
          subtitles and outline far under the narration dock with nothing on
          screen pointing at them. Two anchors, not a redesign. */}
      <nav
        data-uais-learning-mobile-jump="true"
        aria-label={t.learning.playbackViewSwitchLabel}
        className="mb-3 grid grid-cols-2 gap-2 xl:hidden"
      >
        <a href="#uais-learning-stage" className={playbackJumpLinkClassName}>
          {t.learning.playbackStageTab}
        </a>
        <a href="#uais-learning-companion" className={playbackJumpLinkClassName}>
          {t.learning.playbackCompanionTab}
        </a>
      </nav>
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
          id="uais-learning-stage"
          data-uais-learning-playback-workspace="single-viewport"
          className="grid min-w-0 scroll-mt-20 gap-6 xl:max-h-[calc(100dvh-6.5rem)] xl:grid-rows-[minmax(0,1fr)_auto] xl:overflow-hidden"
        >
          <PptStage
            locale={locale}
            publishedPlayback={publishedPlayback}
            activePublishedSlide={activePublishedSlide}
            publishedPlaybackError={publishedPlaybackError}
            isPublishedPlaybackLoading={isPublishedPlaybackLoading}
            conceptCount={studyContent.concepts.length}
            onStudyAction={handleStudyAction}
            signInHref={playbackSignInHref}
            onRetryPublishedPlayback={retryPublishedPlayback}
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
            onSlideNarrationPlay={handleSlideNarrationPlay}
            onSlideNarrationEnded={handleSlideNarrationEnded}
          />
        </div>
        <LearningCompanionPanel
          locale={locale}
          courseId={selectedCourseId}
          approvedInviteContext={visibleApprovedInviteLearningContext}
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
          signInHref={playbackSignInHref}
        />
      </section>
    </div>
  );
}

function LearningCompanionPanel({
  locale,
  courseId,
  approvedInviteContext,
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
  signInHref,
}: {
  locale: Locale;
  courseId: string;
  approvedInviteContext?: { courseId: string; classId: string };
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
  signInHref: string;
}) {
  const sessionUser = useSessionUser();
  const learnerAccount =
    sessionUser?.role === "student" ? sessionUser.account : undefined;
  const classIdForCourse = (eventCourseId: string) =>
    approvedInviteContext?.courseId === eventCourseId
      ? approvedInviteContext.classId
      : undefined;
  // `undefined` when nothing on screen belongs to a course this learner is in -
  // see resolveLearningEventCourseId. Every learning record below is gated on it.
  const eventCourseId = resolveLearningEventCourseId({
    publishedPlaybackCourseId: publishedPlayback?.courseId,
    selectedCourseId: courseId,
    approvedMembershipCourseId: approvedInviteContext?.courseId,
  });
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
  // Annotated rather than inferred: the fallback is now `[]`, and without the
  // annotation TypeScript infers `Line[] | never[]` and narrows the mapped
  // element to `never`.
  const transcript: Array<{
    time: string;
    title: string;
    text: string;
    active: boolean;
    slideIndex: number;
  }> = publishedPlayback
    ? publishedPlayback.slides.map((slide, index) => ({
        time: locale === "zh-CN" ? `第 ${slide.slideNumber} 页` : `Slide ${slide.slideNumber}`,
        title: slide.slideTitle,
        text: slide.narrationText,
        active: slide.slideId === activePublishedSlide?.slideId,
        slideIndex: index,
      }))
    : // No deck, no subtitles. This list used to invent five timestamped
      // subtitle rows ("12:18" through "13:30") describing a loss function,
      // gradient descent and the learning rate - to a student in a mathematics-
      // education course, with fabricated timestamps that made them look like a
      // real recording. The panel renders an empty state instead.
      [];

  const primaryTabs = [
    { view: "ai" as const, label: locale === "zh-CN" ? "智能导学" : "AI Guide" },
    { view: "subtitles" as const, label: locale === "zh-CN" ? "全部字幕" : "Subtitles" },
    { view: "outline" as const, label: locale === "zh-CN" ? "课程目录" : "Outline" },
    { view: "practice" as const, label: locale === "zh-CN" ? "实践" : "Practice" },
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

    if (learnerAccount && eventCourseId) {
      void reportLearningEvent({
        actorId: learnerAccount,
        event: {
          type: "ai.feedback.requested",
          object: {
            id: `${eventCourseId}/ai-guide/${agent.id}`,
            name: `AI guide · ${agent.label}`,
          },
          context: {
            courseId: eventCourseId,
            classId: classIdForCourse(eventCourseId),
            lessonId: publishedPlayback?.audioManifestId,
            locale,
          },
        },
        // Every ask is a distinct learning event, so the key must be unique
        // per request rather than the default per-object dedupe key.
        idempotencyKey: createUniqueLearningEventKey(
          learnerAccount,
          "ai.feedback.requested",
          eventCourseId,
          agent.id,
        ),
      });
    }

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
    <aside
      id="uais-learning-companion"
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_44px_var(--shadow)] xl:sticky xl:top-20 xl:h-[calc(100dvh-6.5rem)]"
    >
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-[var(--border)] p-3">
          <div
            role="group"
            aria-label={locale === "zh-CN" ? "我的学习右侧栏目切换" : "My Learning right column switcher"}
            className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-1 sm:grid-cols-4"
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
                  "h-11 rounded-md border px-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  active && !studyToolsOpen
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-[0_8px_18px_var(--shadow-accent)]"
                    : "border-transparent bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]",
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
              onToggleCheckpoint={(checkpointId) => {
                const expanding = expandedCheckpointId !== checkpointId;
                setExpandedCheckpointId((current) =>
                  current === checkpointId ? undefined : checkpointId,
                );
                if (expanding && learnerAccount && eventCourseId) {
                  void reportLearningEvent({
                    actorId: learnerAccount,
                    event: {
                      type: "activity.attempted",
                      object: {
                        id: `${eventCourseId}/slides/${activePublishedSlide?.slideId ?? "overview"}/checkpoints/${checkpointId}`,
                        name: `Checkpoint · ${studyContent.slideTitle}`,
                      },
                      context: {
                        courseId: eventCourseId,
                        classId: classIdForCourse(eventCourseId),
                        lessonId: publishedPlayback?.audioManifestId,
                        locale,
                      },
                    },
                  });
                }
              }}
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
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Robot size={22} weight="duotone" />
                </span>
                <div className="rounded-xl bg-[var(--surface-elevated)] px-4 py-3 text-sm leading-6 text-[var(--foreground)]">
                  <p>{guideCopy.greeting}</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
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
                    className="min-h-11 w-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-left text-sm font-medium text-[var(--foreground)] shadow-[0_4px_12px_var(--shadow)]"
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
                className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {guideMessages.map((message) => (
                  <div
                    key={message.id}
                    className={[
                      "max-w-[92%] rounded-xl px-4 py-3 text-sm leading-6",
                      message.kind === "user"
                        ? "ml-auto bg-[var(--accent)] text-white"
                        : "bg-[var(--surface-elevated)] text-[var(--foreground)]",
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
                      "rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      active
                        ? "border-[var(--accent)] bg-[var(--surface-elevated)] shadow-[0_10px_22px_var(--shadow-accent)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]",
                      pendingGuideAgentId !== null && !pending ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    <Icon size={18} weight="duotone" className="text-[var(--accent)]" />
                    <p className="mt-2 text-xs font-semibold text-[var(--foreground)]">{agent.label}</p>
                    <p className="mt-1 text-[11px] text-[var(--muted)]">
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
                className="mt-4 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_8px_18px_var(--shadow)]"
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
                  className="h-11 min-w-0 flex-1 rounded-lg bg-[var(--surface-elevated)] px-3 text-sm outline-none placeholder:text-[var(--placeholder)] focus:ring-2 focus:ring-[var(--accent)]"
                />
                <button
                  type="submit"
                  disabled={pendingGuideAgentId !== null}
                  aria-busy={pendingGuideAgentId === "multi-agent"}
                  className="grid size-11 place-items-center rounded-full bg-[var(--accent)] text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
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
              {transcript.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm leading-6 text-[var(--muted)]">
                  {locale === "zh-CN"
                    ? "本课程暂无字幕，课件发布后会在这里显示讲解文本。"
                    : "No subtitles yet. Narration text appears here once a lesson is published."}
                </p>
              ) : null}
              {/*
                Every row is now a real published slide, so every row is
                clickable. The previous `isPublishedLine` branch existed only to
                render the fabricated timestamped rows as inert <div>s; with
                those gone it narrowed to `never`.
              */}
              {transcript.map((line) => {
                const rowClassName = [
                  "grid w-full grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-lg px-2 py-1 text-left text-sm leading-6 outline-none transition hover:bg-[var(--accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                  line.active ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)]",
                ].join(" ");
                const timeClassName = line.active
                  ? "font-semibold text-[var(--accent)]"
                  : "text-[var(--muted)]";
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
                    <span className={timeClassName}>{line.time}</span>
                    <p>{line.text}</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-2">
              <input
                aria-label={locale === "zh-CN" ? "搜索当前页字幕" : "Search subtitles"}
                placeholder={locale === "zh-CN" ? "搜索当前页字幕" : "Search subtitles"}
                className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none placeholder:text-[var(--placeholder)] focus:ring-2 focus:ring-[var(--accent)]"
              />
              <button type="button" className="grid size-11 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)]" aria-label={locale === "zh-CN" ? "筛选字幕" : "Filter subtitles"}>
                <SlidersHorizontal size={18} weight="duotone" />
              </button>
            </div>
          </div>
          ) : null}

          {!studyToolsOpen && activeView === "outline" ? (
            <CourseDirectoryView
              locale={locale}
              learnerAccount={learnerAccount}
              publishedPlayback={publishedPlayback}
              activePublishedSlide={activePublishedSlide}
              onSelectPublishedSlide={onSelectPublishedSlide}
            />
          ) : null}

          {!studyToolsOpen && activeView === "practice" ? (
            <LearningPracticePanel
              locale={locale}
              courseId={eventCourseId}
              classId={eventCourseId ? classIdForCourse(eventCourseId) : undefined}
              lessonKey={publishedPlayback?.learningUnit.lessonKey}
              signInHref={signInHref}
            />
          ) : null}
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
        // Was "Teaching TA", with a prompt asking for a classroom question and a
        // teaching example. Both the zh-CN card and the server persona
        // (`learningGuideAgents` in src/lib/ai/orchestration/learning-guide-graph.ts)
        // call this agent the Code Assistant, so an English-locale student picked
        // a card promising teaching examples and got steps and pseudocode back.
        id: "code-assistant" as const,
        label: "Code Assistant",
        sub: "Algorithms and code",
        icon: GearSix,
        prompt: `Turn "${slideTitle}" into steps, pseudocode, or a short code example`,
      },
    ],
    multiAgentLabel: "LangGraph multi-agent guide",
    buildReceipt: (question: string) =>
      `AI Guide received: ${question}. I will connect ${courseTitle}, the current ${slidePosition} "${slideTitle}", subtitles, and outline for you.`,
    buildMultiAgentReceipt: (question: string) =>
      `The multi-agent chain received: ${question}. Study Advisor, Concept Explainer, and Code Assistant will work together.`,
  };
}

// The outline tab, which used to be the same demo course for everybody.
//
// Whatever deck the learner had open, this panel announced "初等数学研究（2024
// 春）", "康霞博士", a 42% progress bar hard-coded as `w-[42%]`, and the static
// six-chapter syllabus with every lesson but one flagged done. A student in a
// different course read another teacher's course card over their own lesson, and
// a student in *this* course read a completion record nobody had earned.
//
// With a published deck the panel is now built from that deck's manifest, and the
// only progress it shows is the narration the learner actually finished. Without
// one it still shows the template's sample syllabus - clearly labelled as a
// sample, with no progress bar and no done marks.
function CourseDirectoryView({
  locale,
  learnerAccount,
  publishedPlayback,
  activePublishedSlide,
  onSelectPublishedSlide,
}: {
  locale: Locale;
  learnerAccount?: string;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
  onSelectPublishedSlide: (index: number) => void;
}) {
  const zh = locale === "zh-CN";
  const courseId = publishedPlayback?.courseId;
  const audioManifestId = publishedPlayback?.audioManifestId;
  const activeSlideId = activePublishedSlide?.slideId;

  // The narration dock is the writer; this panel only reads, on every render, so
  // a slide finished in this session shows up without a reload. Safe to read
  // during render: the panel is only reached by clicking the outline tab, and the
  // published branch needs a deck that arrives from a client fetch, so neither
  // runs during the server render.
  const completedSlideIds =
    learnerAccount && courseId && audioManifestId
      ? readCompletedNarrationSlideIds(
          createCompletedNarrationStorageKey({ learnerAccount, courseId, audioManifestId }),
        )
      : new Set<string>();

  if (publishedPlayback) {
    const completedSlideCount = publishedPlayback.slides.filter((slide) =>
      completedSlideIds.has(slide.slideId),
    ).length;
    const completedPercentage =
      publishedPlayback.slideCount > 0
        ? Math.round((completedSlideCount / publishedPlayback.slideCount) * 100)
        : 0;
    const deckDurationSeconds = publishedPlayback.slides.reduce(
      (total, slide) => total + (Number.isFinite(slide.durationSeconds) ? slide.durationSeconds : 0),
      0,
    );

    return (
      <div data-uais-learning-outline="published">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex gap-3">
            <div className="grid size-16 place-items-center rounded-lg bg-[linear-gradient(135deg,var(--accent),var(--accent-border))] text-white">
              <BookOpen size={24} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {publishedPlayback.courseTitle}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">{publishedPlayback.teacherName}</p>
              {/* Only a signed-in learner has a progress record to report. For
                  everyone else the panel says nothing about progress rather than
                  drawing a bar nobody's listening to. */}
              {learnerAccount ? (
                <div className="mt-3" data-uais-learning-outline-progress="narration-completion">
                  <div className="flex items-center justify-between text-xs font-semibold text-[var(--muted)]">
                    <span>{zh ? "讲解完成进度" : "Narration progress"}</span>
                    <span className="text-[var(--accent)]">
                      {zh
                        ? `${completedSlideCount} / ${publishedPlayback.slideCount} 页 · ${completedPercentage}%`
                        : `${completedSlideCount} / ${publishedPlayback.slideCount} slides · ${completedPercentage}%`}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[var(--border)]">
                    <div
                      className="h-1.5 rounded-full bg-[var(--accent)]"
                      style={{ width: `${completedPercentage}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <div className="border-b border-[var(--border)] py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3 text-sm font-semibold text-[var(--foreground)]">
              <span>
                {zh
                  ? `课件 · 共 ${publishedPlayback.slideCount} 页`
                  : `Slides · ${publishedPlayback.slideCount} pages`}
              </span>
              <span className="shrink-0 text-[var(--muted)]">
                {formatSlideDurationLabel(deckDurationSeconds)}
              </span>
            </div>
            <div className="mt-3 space-y-1">
              {publishedPlayback.slides.map((slide, index) => {
                const active = slide.slideId === activeSlideId;
                const done = completedSlideIds.has(slide.slideId);

                return (
                  <button
                    type="button"
                    key={slide.slideId}
                    aria-current={active ? "page" : undefined}
                    // "done" is now a fact about this learner's narration record,
                    // so it is worth being able to read back directly.
                    data-uais-learning-outline-lesson={
                      active ? "active" : done ? "completed" : "pending"
                    }
                    onClick={() => onSelectPublishedSlide(index)}
                    className={[
                      "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                      active
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--foreground)] hover:bg-[var(--background)]",
                    ].join(" ")}
                  >
                    <span className="min-w-0 truncate">
                      {zh
                        ? `第 ${slide.slideNumber} 页 ${slide.slideTitle}`
                        : `${slide.slideNumber}. ${slide.slideTitle}`}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[var(--muted)]">
                      {formatSlideDurationLabel(slide.durationSeconds)}
                      {active ? (
                        <PlayCircle size={18} weight="fill" className="text-[var(--accent)]" />
                      ) : done ? (
                        <CheckCircle size={16} weight="duotone" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const chapters = courseDirectoryChapters.map((chapter) => ({
    title: chapter.title[locale],
    time: chapter.time,
    lessons: chapter.lessons.map((lesson, lessonIndex) => ({
      title: lesson.title[locale],
      time: courseDirectoryLessonTimes[lessonIndex % courseDirectoryLessonTimes.length],
    })),
  }));

  return (
    <div data-uais-learning-outline="sample">
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
          {zh ? "示例课程目录" : "Sample course outline"}
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {zh
            ? "本课程暂无已发布课件，以下为模板示例目录，不代表你的学习进度。"
            : "This course has no published lesson yet. The outline below is a template sample and is not your progress."}
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex gap-3">
          <div className="grid size-16 place-items-center rounded-lg bg-[linear-gradient(135deg,var(--accent),var(--accent-border))] text-white">
            <BookOpen size={24} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {zh ? "初等数学研究（2024 春）" : "Elementary Mathematics Research (Spring 2024)"}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{zh ? "康霞博士" : "Dr. Kang Xia"}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        {chapters.map((chapter) => (
          <div key={chapter.title} className="border-b border-[var(--border)] py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3 text-sm font-semibold text-[var(--foreground)]">
              <span>{chapter.title}</span>
              <span className="shrink-0 text-[var(--muted)]">{chapter.time}</span>
            </div>
            <div className="mt-3 space-y-1">
              {chapter.lessons.map((lesson) => (
                <div
                  key={lesson.title}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-[var(--foreground)]"
                >
                  <span>{lesson.title}</span>
                  <span className="text-[var(--muted)]">{lesson.time}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <button type="button" className="flex h-12 w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)]">
          <span className="inline-flex items-center gap-2">
            <FilePdf size={18} weight="duotone" />
            {zh ? "课程资料" : "Course materials"}
          </span>
          <ArrowRight size={17} weight="bold" />
        </button>
      </div>
    </div>
  );
}

export { HumanAiChatroom, LearningChatroomPage } from "./learning-page-chatroom";
