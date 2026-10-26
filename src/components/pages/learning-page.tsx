"use client";

import Link from "next/link";
import { ClassroomCourseRouter } from "./classroom-learning-page";
import { CourseDirectoryView, PublishedPlaybackAccessNotice } from "./learning-page-outline";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChatsCircle } from "@phosphor-icons/react/dist/ssr/ChatsCircle";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
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
  playbackByCourseId,
  publishedLearningPptCourseId,
  type PlaybackContent,
} from "./learning-page-content";
import {
  createAskThisSlidePrompt,
  createCompletedNarrationStorageKey,
  createSlideStudyContent,
  exportSlideStudyNotes,
  getFallbackCourseTitle,
  getPlaybackContent,
  isPublishedPlaybackAccessBlocked,
  type PublishedPlaybackError,
  readCompletedNarrationSlideIds,
  resolveLearningEventCourseId,
  type SlideStudyContent,
  type StudyAction,
  type StudyToolView,
} from "./learning-page-helpers";
import { getAiGuideCopy } from "./learning-page-guide-copy";
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

// Carries the HTTP status so a refusal can be reported as a refusal.
class LearningAiGuideRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LearningAiGuideRequestError";
    this.status = status;
  }
}

function getSelectedStudyToolView(view: CompanionView): StudyToolView {
  if (view === "checkpoint" || view === "concepts" || view === "notes") {
    return view;
  }

  return "notes";
}

type LearningPageProps = {
  initialCourseId?: string;
  initialClassId?: string;
  initialLessonKey?: string;
  initialActivityId?: string;
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

// The id of the template's own sample course when that is what the URL asked for,
// and `undefined` for every other course. It used to answer `fallbackCourseId` for
// anything unknown, which handed a real course the demo course's identity, copy and
// - through the AI-guide payload - the demo course's id, on a page the learner had
// opened for their own course.
function getSampleCourseId(courseId: string | undefined) {
  return courseId && Object.hasOwn(playbackByCourseId, courseId) ? courseId : undefined;
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

export function LearningPage(props: LearningPageProps = {}) {
  const user = useSessionUser();
  const canonicalLesson = /^lesson-[0-9a-f-]{36}$/i.test(props.initialLessonKey ?? "");
  const inspectCatalog = props.initialCourseId && user?.role === "student" &&
    (canonicalLesson || (!props.initialLessonKey && props.initialCourseId !== publishedLearningPptCourseId));
  if (inspectCatalog) return <ClassroomCourseRouter courseId={props.initialCourseId!} classId={props.initialClassId} lessonKey={props.initialLessonKey} activityId={props.initialActivityId} legacy={<LegacyLearningPage {...props} />} />;
  return <LegacyLearningPage {...props} />;
}

function LegacyLearningPage({ initialCourseId, initialClassId, initialLessonKey, initialActivityId }: LearningPageProps = {}) {
  const { locale } = useAppPreferences();
  const sessionUser = useSessionUser();
  const learnerAccount =
    sessionUser?.role === "student" ? sessionUser.account : undefined;
  const t = copy[locale];
  const sampleCourseId = getSampleCourseId(initialCourseId);

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
  const playback = isPublishedPlaybackAccessBlocked(publishedPlaybackError)
    ? undefined
    : getPlaybackContent(sampleCourseId, locale);
  const [approvedInviteLearningContext, setApprovedInviteLearningContext] =
    useState<ApprovedInviteLearningContext>();
  const [activeCompanionView, setActiveCompanionView] = useState<CompanionView>(initialActivityId ? "practice" : "ai");
  const [studyToolsOpen, setStudyToolsOpen] = useState(false);
  const [studyActionNotice, setStudyActionNotice] = useState("");
  const [guideDraft, setGuideDraft] = useState("");
  const [guideFocusSequence, setGuideFocusSequence] = useState(0);
  const completedNarrationSlideIdsRef = useRef(new Set<string>());
  const studyContent = useMemo(
    () =>
      publishedPlayback && activePublishedSlide ? createSlideStudyContent({
        locale,
        publishedPlayback,
        activePublishedSlide,
      }) : undefined,
    [activePublishedSlide, locale, publishedPlayback],
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
    // No slide, nothing to study. The action bar disables itself in this state;
    // this is the guard for anything that reaches the handler another way.
    if (!studyContent) {
      if (action === "notes" || action === "checkpoint" || action === "concepts") {
        setActiveCompanionView(action);
        setStudyToolsOpen(true);
      }
      return;
    }

    if (action === "export") {
      exportSlideStudyNotes(studyContent, locale);
      setStudyActionNotice(t.learning.notesExported);
      const eventCourseId = resolveLearningEventCourseId({
        publishedPlaybackCourseId: publishedPlayback?.courseId,
        selectedCourseId: sampleCourseId ?? initialCourseId,
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
  // Only a course name something on this page can actually vouch for: the deck
  // being played, the sample course the URL asked for, or the class this learner
  // was approved into. When none of the three answers, the bar says the lesson has
  // not loaded instead of naming a course at random - it used to read
  // "当前课程：大学研究方法" over anybody's unpublished course.
  const visibleCourseName =
    publishedPlayback?.courseTitle ??
    getFallbackCourseTitle(getPlaybackContent(sampleCourseId, locale), locale) ??
    visibleApprovedInviteLearningContext?.courseName;
  const visibleCourseContextTitle = visibleCourseName
    ? `${locale === "zh-CN" ? "当前课程：" : "Current course: "}${visibleCourseName}`
    : locale === "zh-CN"
      ? "尚未加载课程课件"
      : "No lesson loaded yet";
  // `undefined` renders no slide segment at all rather than another course's slide.
  const visibleCourseContextSlideTitle =
    activePublishedSlide?.slideTitle;
  // A 401 on the deck used to render as a dead label. The return path is built
  // from the route's own props rather than `window.location`, so the href is the
  // same string on the server render and on the first client render.
  const playbackSignInHref = createLoginHandoffHref(
    createLearningReturnPath({ courseId: initialCourseId, classId: initialClassId, lessonKey: initialLessonKey, activityId: initialActivityId }),
  );

  return (
    <div className="relative left-1/2 -my-6 w-screen -translate-x-1/2 bg-[var(--background)] px-3 py-3 text-[var(--foreground)] sm:px-4 lg:px-5">
      <div
        data-uais-learning-course-context="selected-course"
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm font-semibold text-[var(--foreground)]"
      >
        <span>{visibleCourseContextTitle}</span>
        {visibleCourseContextSlideTitle ? (
          <>
            <span className="text-[var(--placeholder)]">/</span>
            <span className="text-[var(--muted)]">{visibleCourseContextSlideTitle}</span>
          </>
        ) : null}
        {visibleApprovedInviteLearningContext ? (
          <>
            <span className="text-[var(--placeholder)]">/</span>
            {/* Skipped when the title above is already this course's name, which
                it is whenever no deck or sample supplied one. */}
            {visibleCourseName === visibleApprovedInviteLearningContext.courseName ? null : (
              <span className="text-[var(--accent)]">
                {visibleApprovedInviteLearningContext.courseName}
              </span>
            )}
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
            conceptCount={studyContent?.concepts.length ?? 0}
            hasStudyContent={Boolean(studyContent)}
            onStudyAction={handleStudyAction}
            signInHref={playbackSignInHref}
            onRetryPublishedPlayback={retryPublishedPlayback}
          />
          {studyActionNotice ? <p role="status" className="text-sm text-[var(--muted)]">{studyActionNotice}</p> : null}
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
          courseId={sampleCourseId ?? initialCourseId}
          requestedLessonKey={initialLessonKey}
          requestedActivityId={initialActivityId}
          approvedInviteContext={visibleApprovedInviteLearningContext}
          publishedPlaybackError={publishedPlaybackError}
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
  requestedLessonKey,
  requestedActivityId,
  approvedInviteContext,
  publishedPlaybackError,
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
  courseId?: string;
  requestedLessonKey?: string;
  requestedActivityId?: string;
  approvedInviteContext?: { courseId: string; classId: string; courseName?: string };
  publishedPlaybackError?: PublishedPlaybackError;
  playback?: PlaybackContent;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
  onSelectPublishedSlide: (index: number) => void;
  studyContent?: SlideStudyContent;
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
  // The course the guide is allowed to speak for: the deck on the stage, the
  // sample course the URL named, or the class this learner was approved into.
  // Without one there is nothing to scope a question to, and the composer says so
  // instead of firing a request the server is bound to refuse.
  const guideCourseId =
    publishedPlayback?.courseId ?? courseId ?? approvedInviteContext?.courseId;
  const guideCourseTitle =
    publishedPlayback?.courseTitle ??
    getFallbackCourseTitle(playback, locale) ??
    approvedInviteContext?.courseName;
  // Shown when the learner actually sends. The composer stays usable while a deck
  // is still loading; what must not happen is firing a request scoped to a course
  // this page cannot name.
  const guideCourseScopeMissing = guideCourseId
    ? undefined
    : locale === "zh-CN"
      ? "本课程暂无已发布课件，智能导学还无法确定要回答哪门课程。"
      : "This course has no published lesson yet, so the AI guide cannot tell which course to answer for.";
  const [guideMessages, setGuideMessages] = useState<AiGuideMessage[]>([]);
  const [guideError, setGuideError] = useState("");
  const [activeGuideAgentId, setActiveGuideAgentId] =
    useState<LearningAiGuideAgentId>("concept-explainer");
  const [pendingGuideAgentId, setPendingGuideAgentId] =
    useState<LearningAiGuideAgentId | "multi-agent" | null>(null);
  const [expandedCheckpointId, setExpandedCheckpointId] = useState<string>();
  const [subtitleQuery, setSubtitleQuery] = useState("");
  const [currentPageSubtitlesOnly, setCurrentPageSubtitlesOnly] = useState(false);
  const subtitleCopy = copy[locale].learning.subtitles;
  const guideRequestCounterRef = useRef(0);
  const guideInputRef = useRef<HTMLInputElement | null>(null);
  const guideTranscriptRef = useRef<HTMLDivElement | null>(null);
  const guideCopy = getAiGuideCopy(
    locale,
    playback,
    publishedPlayback,
    activePublishedSlide,
    // Without a deck or a sample, the approved membership is the only thing that
    // can name this course — so the guide introduces itself as the learner's own
    // course rather than as nobody.
    guideCourseTitle,
  );
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
  const normalizedSubtitleQuery = subtitleQuery.trim().toLocaleLowerCase(locale);
  const visibleTranscript = transcript.filter(
    (line) =>
      (!currentPageSubtitlesOnly || line.active) &&
      [line.text, line.title, line.time].some((value) =>
        value.toLocaleLowerCase(locale).includes(normalizedSubtitleQuery),
      ),
  );

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
    // Nothing on this page can say which course the question belongs to, and the
    // server authorizes every guide request against course membership (a request
    // with no course id is refused as `course-context-required`). Sending anyway
    // is what surfaced as "智能服务暂时不可用" while the service was answering
    // fine. Both entry points - the composer and the three agent cards - land
    // here, so this is the one place the check belongs.
    if (isPublishedPlaybackAccessBlocked(publishedPlaybackError)) return;
    if (guideCourseScopeMissing) {
      setGuideError(guideCourseScopeMissing);
      return;
    }

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
        throw new LearningAiGuideRequestError(
          body.error ?? "Learning AI guide request failed.",
          response.status,
        );
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
    } catch (error) {
      // A refusal is not an outage. 401/403 mean the session or this learner's
      // membership in THIS course is the problem, and calling that "service
      // unavailable" sent learners to wait for a service that was answering fine.
      const status = error instanceof LearningAiGuideRequestError ? error.status : undefined;
      setGuideError(
        status === 401
          ? locale === "zh-CN"
            ? "登录状态已过期，请重新登录后再提问。"
            : "Your session has expired. Sign in again to ask a question."
          : status === 403
            ? locale === "zh-CN"
              ? "当前账号无权就本课程提问，请确认课程加入状态。"
              : "This account cannot ask questions about this course. Check your course membership."
            : locale === "zh-CN"
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
    const slideImageUrl = activePublishedSlide?.imageUrl
      ? new URL(activePublishedSlide.imageUrl, window.location.origin).toString()
      : undefined;
    // A slide the learner is not looking at is not context, it is a wrong answer
    // waiting to happen: these fields stay undefined rather than describing the
    // demo deck's slide 3.
    const slide = activePublishedSlide
      ? {
          slideNumber: activePublishedSlide.slideNumber,
          slideTitle: activePublishedSlide.slideTitle,
          narrationText: activePublishedSlide.narrationText,
          imageUrl: slideImageUrl,
        }
      : playback
        ? {
            slideTitle: playback.slideTitle,
            narrationText: playback.subtitles.find((subtitle) => subtitle.active)?.text,
          }
        : {};

    return {
      agentId,
      mode,
      locale,
      question,
      course: {
        // `guideCourseId` is the course this page is actually about. It used to be
        // the demo course id whenever no deck had loaded, so every question a
        // learner asked about their own unpublished course was authorized against
        // a course they are not enrolled in, came back 403, and surfaced as
        // "智能服务暂时不可用" - the guide was simply dead in that state.
        courseId: guideCourseId,
        courseTitle: guideCourseTitle,
      },
      slide,
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
          {isPublishedPlaybackAccessBlocked(publishedPlaybackError) ? (
            <PublishedPlaybackAccessNotice locale={locale} error={publishedPlaybackError} />
          ) : (<>
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
                if (expanding && learnerAccount && eventCourseId && studyContent) {
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
              {transcript.length > 0 && visibleTranscript.length === 0 ? (
                <p role="status" className="px-2 py-6 text-center text-sm leading-6 text-[var(--muted)]">
                  {subtitleCopy.noMatches}
                </p>
              ) : null}
              {/*
                Every row is now a real published slide, so every row is
                clickable. The previous `isPublishedLine` branch existed only to
                render the fabricated timestamped rows as inert <div>s; with
                those gone it narrowed to `never`.
              */}
              {visibleTranscript.map((line) => {
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
                type="search"
                aria-label={subtitleCopy.searchLabel}
                placeholder={subtitleCopy.searchPlaceholder}
                value={subtitleQuery}
                onChange={(event) => setSubtitleQuery(event.target.value)}
                disabled={transcript.length === 0}
                className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none placeholder:text-[var(--placeholder)] focus:ring-2 focus:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setCurrentPageSubtitlesOnly((current) => !current)}
                aria-label={subtitleCopy.currentPageOnly}
                aria-pressed={currentPageSubtitlesOnly}
                disabled={transcript.length === 0}
                className={`inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold text-[var(--accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
                  currentPageSubtitlesOnly
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <SlidersHorizontal size={18} weight="duotone" />
                <span>{subtitleCopy.currentPageLabel}</span>
              </button>
            </div>
            {subtitleQuery || currentPageSubtitlesOnly ? (
              <button
                type="button"
                aria-label={subtitleCopy.resetFilters}
                onClick={() => {
                  setSubtitleQuery("");
                  setCurrentPageSubtitlesOnly(false);
                }}
                className="mt-1 min-h-11 rounded-lg px-2 text-sm text-[var(--accent)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {subtitleCopy.resetLabel}
              </button>
            ) : null}
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
              lessonKey={requestedLessonKey ?? publishedPlayback?.learningUnit.lessonKey}
              requestedActivityId={requestedActivityId}
              signInHref={signInHref}
            />
          ) : null}
          </>)}
        </div>
      </div>
    </aside>
  );
}

export { HumanAiChatroom, LearningChatroomPage } from "./learning-page-chatroom";
