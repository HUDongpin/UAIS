"use client";

// Slide-stage presentation for the learner workspace (Phase 3 decomposition of
// learning-page.tsx): the chapter rail, the PPT stage and its published-English slide
// frame and the study action bar. Presentational —
// props-driven, no chatroom coupling.



import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { ChatTeardropText } from "@phosphor-icons/react/dist/ssr/ChatTeardropText";
import { CornersIn } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOut } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { Notebook } from "@phosphor-icons/react/dist/ssr/Notebook";
import { SignIn } from "@phosphor-icons/react/dist/ssr/SignIn";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Target } from "@phosphor-icons/react/dist/ssr/Target";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import { copy, type Locale } from "@/i18n/copy";
import {
  getPublishedPlaybackEmptyDescription,
  getPublishedPlaybackEmptyTitle,
  getPublishedPlaybackErrorLabel,
  type PublishedPlaybackError,
  type StudyAction,
} from "./learning-page-helpers";

export function SlideChapterRail({
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
    : // No deck, no chapters. This list used to invent a seven-slide machine-
      // learning outline - "3.1 线性回归问题" through "课堂练习", with slide 30
      // pinned active - beside the fabricated lecture on the stage. Both are
      // now empty states.
      [];

  return (
    <aside className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_38px_var(--shadow)] xl:sticky xl:top-20 xl:h-[calc(100dvh-6.5rem)]">
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-3 text-sm font-semibold text-[var(--foreground)]">
          <span>
            {publishedPlayback
              ? locale === "zh-CN"
        ? `课件 1 / ${publishedPlayback.slideCount}`
                : `PPT 1 / ${publishedPlayback.slideCount}`
              : locale === "zh-CN"
                ? "课件"
                : "Slides"}
          </span>
          <span className="text-lg text-[var(--placeholder)]">×</span>
        </div>
        <div className="flex gap-3 overflow-x-auto p-3 xl:block xl:space-y-3 xl:overflow-y-auto xl:overflow-x-hidden">
          {slides.map((slide) => (
            <button
              key={slide.number}
              type="button"
              onClick={"onClick" in slide ? slide.onClick : undefined}
              className={[
                "relative w-[120px] shrink-0 rounded-xl border bg-[var(--surface)] p-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)] xl:w-full",
                slide.active
                  ? "border-[var(--accent)] shadow-[0_12px_24px_var(--shadow-accent)]"
                  : "border-[var(--border)] hover:border-[var(--accent-border)]",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute -left-2 top-3 flex size-6 items-center justify-center rounded-full text-[11px] font-semibold",
                  slide.active ? "bg-[var(--accent)] text-white" : "bg-[var(--border)] text-[var(--muted)]",
                ].join(" ")}
              >
                {slide.number}
              </span>
              <span className="ml-3 block min-h-[52px] rounded-lg bg-[var(--surface)] p-2 text-[10px] font-semibold leading-4 text-[var(--foreground)]">
                {slide.title}
                {slide.active ? (
                  <span className="mt-2 block h-7 rounded bg-[linear-gradient(135deg,var(--accent-soft),var(--accent-border))]" />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function PptStage({
  locale,
  publishedPlayback,
  activePublishedSlide,
  publishedPlaybackError,
  isPublishedPlaybackLoading,
  conceptCount,
  onStudyAction,
  signInHref,
  onRetryPublishedPlayback,
}: {
  locale: Locale;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
  publishedPlaybackError?: PublishedPlaybackError;
  isPublishedPlaybackLoading?: boolean;
  conceptCount: number;
  onStudyAction: (action: StudyAction) => void;
  /** Where a signed-out deck refusal sends the learner, with a return path. */
  signInHref?: string;
  onRetryPublishedPlayback?: () => void;
}) {
  const pptFrameRef = useRef<HTMLElement | null>(null);
  const [isPptFullscreen, setIsPptFullscreen] = useState(false);
  // `imageUrl` is built from the pptAssetId for every slide unconditionally, so
  // it is never empty and the placeholder branch below was unreachable: a deck
  // published without its page images showed a broken image icon instead of the
  // "课件图片准备中" frame that was written for exactly that case. Remembered per
  // URL so paging back to a missing slide does not flash the broken frame again.
  const [failedSlideImageUrls, setFailedSlideImageUrls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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
          : "border-[var(--border)] bg-[var(--surface)]/95 text-[var(--accent)] shadow-[0_10px_24px_var(--shadow-accent)] backdrop-blur hover:border-[var(--accent-border)] hover:bg-[var(--surface)] focus-visible:ring-[var(--accent)]",
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
        className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_44px_var(--shadow)] xl:h-full xl:min-h-[calc(100dvh-13.5rem)]"
      >
        <div
          data-uais-learning-ppt-stage-body="expanded-slide"
          className="relative min-h-0 flex-1 p-4 lg:p-5 xl:grid xl:grid-rows-[auto_minmax(0,1fr)]"
        >
          {!isPptFullscreen ? fullscreenButton("right-5 top-5 lg:right-7 lg:top-7") : null}

          <div
            data-uais-learning-course-path="published-ppt"
            className="inline-flex min-h-10 max-w-[calc(100%-3.5rem)] items-center gap-2 rounded-lg px-1 pr-14 text-sm font-semibold text-[var(--muted)] sm:pr-16"
          >
            <CaretLeft size={18} weight="bold" className="shrink-0 text-[var(--muted)]" />
            {/*
              Every published deck used to be announced as "第一讲 / 第一节"
              ("Lecture 1 / Section 1") in both locales - a position nothing in
              the manifest supports. A teacher's third deck said lecture one, and
              slide nineteen still said section one. The trail is now read off
              the deck itself: its course, its own title, and where in it the
              learner actually is. The demo course gets no exception; it simply
              has real deck data to read.
            */}
            <span className="truncate">
              {[
                publishedPlayback.courseTitle,
                readPublishedDeckLabel(publishedPlayback.sourceDeckTitle),
                locale === "zh-CN"
                  ? `第 ${activePublishedSlide.slideNumber} 页，共 ${publishedPlayback.slideCount} 页`
                  : `Slide ${activePublishedSlide.slideNumber} of ${publishedPlayback.slideCount}`,
              ]
                .filter(Boolean)
                .join(" / ")}
            </span>
          </div>

          <figure
            ref={pptFrameRef}
            data-uais-learning-ppt-frame="active-slide"
            className={
              isPptFullscreen
                ? "relative flex h-screen w-screen items-center justify-center overflow-hidden rounded-none border-0 bg-black p-0 shadow-none"
                : "relative mx-auto mt-4 flex aspect-[1467/825] w-full max-w-[min(100%,92vw,765px)] min-h-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--accent-soft)] bg-[var(--surface)] shadow-[0_18px_42px_var(--shadow-accent)] xl:mt-3 xl:max-w-[min(100%,103dvh)]"
            }
          >
            {isPptFullscreen ? fullscreenButton("right-4 top-4") : null}
            {/*
              The published page image is the lesson, in both locales. The
              English branch used to be taken *first*, so an en-US learner never
              saw `slide.imageUrl` at all - they got a generated card carrying
              the demo course's eyebrow and teacher name instead of the deck
              their teacher published. The English frame is still here, but as
              this locale's flavour of the missing-image fallback below.
            */}
            {activePublishedSlide.imageUrl &&
            !failedSlideImageUrls.has(activePublishedSlide.imageUrl) ? (
              <Image
                src={activePublishedSlide.imageUrl}
                alt={slideImageAlt}
                width={1467}
                height={825}
                sizes="(min-width: 1280px) 960px, 92vw"
                loading="eager"
                unoptimized
                onError={() =>
                  setFailedSlideImageUrls((failed) =>
                    new Set(failed).add(activePublishedSlide.imageUrl),
                  )
                }
                className={
                  isPptFullscreen
                    ? "h-full max-h-screen w-full bg-black object-contain"
                    : "h-full w-full bg-[var(--surface)] object-contain"
                }
              />
            ) : locale === "en-US" ? (
              <PublishedEnglishSlideFrame
                slide={activePublishedSlide}
                courseTitle={publishedPlayback.courseTitle}
                teacherName={publishedPlayback.teacherName}
                alt={slideImageAlt}
                isFullscreen={isPptFullscreen}
              />
            ) : (
              <div
                className={
                  isPptFullscreen
                    ? "grid h-full w-full place-items-center bg-black px-6 text-center text-sm font-semibold text-white"
                    : "grid h-full w-full place-items-center bg-[var(--surface-elevated)] px-6 text-center text-sm font-semibold text-[var(--muted)]"
                }
              >
                课件图片准备中
              </div>
            )}
          </figure>

          <div
            data-uais-learning-slide-count="stage-overlay"
            className="mt-3 text-right text-sm font-medium text-[var(--muted)] xl:pointer-events-none xl:absolute xl:bottom-3 xl:right-5 xl:mt-0"
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
    <section
      aria-busy={isPublishedPlaybackLoading || undefined}
      className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_44px_var(--shadow)]"
    >
      <div className="relative min-h-[470px] p-7 lg:p-9 xl:min-h-[555px]">
        {publishedPlaybackError ? (
          <div
            role="alert"
            data-uais-learning-ppt-error={publishedPlaybackError}
            className={[
              "absolute right-7 top-7 z-10 inline-flex flex-wrap items-center justify-end gap-2 rounded-xl border px-3 py-2 text-sm font-semibold",
              publishedPlaybackError === "unavailable"
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c] dark:border-[#7c4a1d] dark:bg-[#3a2410] dark:text-[#fdba74]",
            ].join(" ")}
          >
            {getPublishedPlaybackErrorLabel(locale, publishedPlaybackError)}
            {/* "Sign in again to access the PPT" with nowhere to sign in is
                where this pill used to end. */}
            {publishedPlaybackError === "auth-required" && signInHref ? (
              <Link
                href={signInHref}
                data-uais-learning-ppt-sign-in="true"
                className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--accent)] px-2.5 text-xs font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              >
                <SignIn size={13} weight="bold" aria-hidden="true" />
                {copy[locale].auth.signIn}
              </Link>
            ) : null}
            {publishedPlaybackError === "unavailable" && onRetryPublishedPlayback ? (
              <button
                type="button"
                className="inline-flex min-h-9 items-center rounded-full bg-[var(--accent)] px-3 text-xs font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
                onClick={onRetryPublishedPlayback}
              >
                {locale === "zh-CN" ? "重新加载课件" : "Retry loading slides"}
              </button>
            ) : null}
          </div>
        ) : isPublishedPlaybackLoading ? (
          <div
            role="status"
            data-uais-learning-ppt-loading="true"
            className="absolute right-7 top-7 z-10 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-semibold text-[var(--foreground)]"
          >
            {locale === "zh-CN" ? "正在加载课件…" : "Loading slides…"}
          </div>
        ) : null}
        {/*
          An honest empty state, not a lecture.

          This block used to render a complete, invented machine-learning
          lesson - "3.2 梯度下降算法", a goal, an update rule, a θ/η/∇J list, a
          diagram and a "30 / 68" counter - whenever no deck had loaded. To a
          student enrolled in a mathematics-education course it was
          indistinguishable from real course content, and it appeared precisely
          when something had gone wrong and they most needed to be told so.
        */}
        <div
          data-uais-learning-ppt-empty="true"
          className="flex min-h-[380px] flex-col items-center justify-center gap-3 px-6 text-center xl:min-h-[465px]"
        >
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--foreground)]">
            {getPublishedPlaybackEmptyTitle(locale)}
          </h1>
          <p className="max-w-md text-base leading-7 text-[var(--muted)]">
            {getPublishedPlaybackEmptyDescription(locale)}
          </p>
        </div>
      </div>

      <StudyActionBar
        locale={locale}
        conceptCount={conceptCount}
        onStudyAction={onStudyAction}
      />
    </section>
  );
}

// The en-US stand-in for a page image that could not be loaded, standing where
// the zh-CN branch shows "课件图片准备中".
//
// Deliberately NOT tokenized: it stands in for the slide itself, and a deck page
// is a white document in both themes — exactly like the JPEG beside it. Theming
// it would make the same lecture look like two different decks. The frame around
// it is tokenized, so the dark theme still reads as one surface.
//
// Every word on it now comes from the manifest of the deck actually being played.
// The eyebrow was the literal string "Elementary Mathematics Research" and the
// footer "Dr. Kang Xia", stamped onto whichever course an en-US learner opened,
// so a student of any other course read a demo course's branding across their
// own teacher's lesson.
function PublishedEnglishSlideFrame({
  slide,
  courseTitle,
  teacherName,
  alt,
  isFullscreen,
}: {
  slide: LearningPptPlaybackSlide;
  courseTitle: string;
  teacherName: string;
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
            {courseTitle}
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
        <span>{teacherName}</span>
        <span>Slide {slide.slideNumber}</span>
      </div>
    </div>
  );
}

// The deck's own title, as the trail should read it. `sourceDeckTitle` is the
// published deck name and carries its upload extension; the extension is the one
// thing here that is a file artefact rather than a title, so it is dropped for
// display (the manifest value itself is untouched, and the learner UI still
// shows no filename). A deck published without a title contributes no segment
// rather than an empty one.
function readPublishedDeckLabel(sourceDeckTitle: string) {
  return sourceDeckTitle.trim().replace(/\.pptx?$/i, "").trim();
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
        "grid border-t border-[var(--border)] bg-[var(--surface)] sm:grid-cols-5",
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
              "relative inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              compact ? "h-10" : "h-11",
            ].join(" ")}
          >
            <Icon size={17} weight="duotone" />
            {action.label}
            {action.badge ? (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-2 flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] text-white"
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
