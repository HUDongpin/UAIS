"use client";

// Slide-stage presentation for the learner workspace (Phase 3 decomposition of
// learning-page.tsx): the chapter rail, the PPT stage and its published-English slide
// frame, the study action bar, and the gradient-descent diagram. Presentational —
// props-driven, no chatroom coupling.



import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { ChatTeardropText } from "@phosphor-icons/react/dist/ssr/ChatTeardropText";
import { CornersIn } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOut } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { Notebook } from "@phosphor-icons/react/dist/ssr/Notebook";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Target } from "@phosphor-icons/react/dist/ssr/Target";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import type { Locale } from "@/i18n/copy";
import {
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

export function PptStage({
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
