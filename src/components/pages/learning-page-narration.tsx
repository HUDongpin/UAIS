"use client";

// Narration playback dock for the learner workspace (Phase 3 decomposition of
// learning-page.tsx): the audio transport with play/pause, seek, and speed controls,
// plus its rate/time formatting helpers. Presentational + local playback state; no
// chatroom coupling.



import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { PauseCircle } from "@phosphor-icons/react/dist/ssr/PauseCircle";
import { PlayCircle } from "@phosphor-icons/react/dist/ssr/PlayCircle";
import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerSlash } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import type { Locale } from "@/i18n/copy";
import type { PlaybackContent } from "./learning-page-content";

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

export function NarrationDock({
  locale,
  playback,
  publishedPlayback,
  activePublishedSlide,
  activePublishedSlideIndex,
  onPreviousPublishedSlide,
  onNextPublishedSlide,
  studyToolsOpen,
  onOpenStudyTools,
  onSlideNarrationPlay,
  onSlideNarrationEnded,
}: {
  locale: Locale;
  playback?: PlaybackContent;
  publishedPlayback?: LearningPptPlaybackManifest;
  activePublishedSlide?: LearningPptPlaybackSlide;
  activePublishedSlideIndex: number;
  onPreviousPublishedSlide: () => void;
  onNextPublishedSlide: () => void;
  studyToolsOpen: boolean;
  onOpenStudyTools: () => void;
  onSlideNarrationPlay?: (slide: LearningPptPlaybackSlide) => void;
  onSlideNarrationEnded?: (slide: LearningPptPlaybackSlide) => void;
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
  // The sample course's own default rate when the URL named one; otherwise the
  // first supported rate. `playback` is undefined for a course with no published
  // deck, and a default is the whole of what this needs from it.
  const sourceSpeed = playback?.speed ?? formatNarrationPlaybackRate(NARRATION_PLAYBACK_RATES[0], locale);
  const [narrationPlaybackRateState, setNarrationPlaybackRateState] = useState(() => ({
    sourceSpeed,
    index: getNarrationPlaybackRateIndex(sourceSpeed),
  }));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const narrationPlaybackRateIndex =
    narrationPlaybackRateState.sourceSpeed === sourceSpeed
      ? narrationPlaybackRateState.index
      : getNarrationPlaybackRateIndex(sourceSpeed);
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
      sourceSpeed,
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
      className="mt-10 min-w-0 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_18px_44px_var(--shadow)] xl:mt-20 xl:min-h-0"
    >
      {/*
        Wrapping flex row, not a rigid three-column grid.

        The grid demanded 220 + 340 + 300 plus gaps — about 892px — inside a
        stage column that is only `viewport - 640px` wide (the page reserves
        156px for the chapter rail and 420px for the companion). So from `xl`
        (1280px) up to roughly 1500px the third column was pushed past the
        column edge and clipped by the companion panel: on an ordinary 13"-15"
        laptop the learner could not see or reach Previous, Next, the speed
        toggle or Study Tools at all, and the mute button underneath them
        answered clicks with a slide change.

        Wrapping keeps every control on screen at every width and simply moves
        the segment controls onto a second line when the column is short.
      */}
      <div
        data-uais-learning-narration-dock-layout="desktop"
        className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:gap-4"
      >
        <div
          data-uais-learning-narration-profile={
            publishedPlayback ? "published-teacher" : "fallback-teacher"
          }
          className="flex min-w-0 items-center gap-3 xl:w-[220px] xl:shrink-0"
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
                    background: `conic-gradient(from 0deg, var(--accent) ${teacherAvatarProgress}%, var(--accent-soft) ${teacherAvatarProgress}% 100%)`,
                  }
                : undefined
            }
            className={[
              "grid size-18 shrink-0 place-items-center rounded-full p-1 text-lg font-semibold text-[var(--accent)] transition-[background] duration-200",
              publishedPlayback ? "shadow-[0_0_0_3px_var(--accent-soft)]" : "bg-[linear-gradient(135deg,var(--surface-elevated),var(--accent-soft))]",
            ].join(" ")}
          >
            <span className="grid size-16 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,var(--surface-elevated),var(--accent-soft))] ring-2 ring-[var(--surface)]">
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
                <SpeakerSlash
                  size={24}
                  weight="duotone"
                  aria-hidden="true"
                  className="text-[var(--placeholder)]"
                />
              )}
            </span>
          </span>
          {/*
            No deck, no teacher. This card used to introduce "李明远 教授" of
            "机器学习导论" - a teacher and a course that exist nowhere in this
            project - beside an honest "本课程暂无已发布课件" empty state on the
            stage, so the one surface telling the learner the truth was flanked by
            two that did not.
          */}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-[var(--foreground)]">
              {publishedPlayback?.teacherName ??
                (locale === "zh-CN" ? "讲解尚未发布" : "No narration yet")}
            </p>
            <p className="mt-1 truncate text-base text-[var(--muted)]">
              {publishedPlayback?.courseTitle ??
                (locale === "zh-CN"
                  ? "教师发布课件后可播放"
                  : "Available once a lesson is published")}
            </p>
          </div>
        </div>

        {/* `min-w-0`: a flex item defaults to `min-width:auto`, so without it this
            column refuses to shrink below its content and overflows the row. */}
        <div className="min-w-0 xl:min-w-[280px] xl:flex-1">
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
                  onSlideNarrationPlay?.(activePublishedSlide);
                }}
                onPause={() => {
                  setSpeakingSlideId(undefined);
                }}
                onEnded={() => {
                  setSpeakingSlideId(undefined);
                  syncNarrationProgress();
                  onSlideNarrationEnded?.(activePublishedSlide);
                }}
                onTimeUpdate={syncNarrationProgress}
                onLoadedMetadata={syncNarrationProgress}
                onVolumeChange={(event) => {
                  setIsNarrationMuted(event.currentTarget.muted);
                }}
              />
              {/*
                The seek rail track is `minmax(0,...)`, not `minmax(160px,...)`,
                and the mute track is the button's real 44px rather than 40px.
                With hard minimums this row demanded ~410px inside a
                `minmax(340px,440px)` dock column, so on every laptop width it
                overflowed its column by ~78px and slid UNDER the segment
                controls, which paint later. `elementFromPoint` on the speaker
                icon returned the Next button: clicking mute advanced the slide
                instead of muting, and the last 22px of the seek rail was
                unhittable. Let the rail absorb the shortfall instead.
              */}
              <div
                data-uais-learning-audio-controls="custom"
                className="grid min-w-0 gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 shadow-[inset_0_1px_0_var(--shadow)] sm:grid-cols-[44px_auto_minmax(0,1fr)_44px] sm:items-center sm:justify-start sm:gap-3"
              >
                <button
                  type="button"
                  onClick={handlePrimaryNarrationToggle}
                  aria-pressed={isNarrationPlaying}
                  className="grid size-11 place-items-center rounded-full bg-[var(--accent)] text-white shadow-[0_14px_28px_var(--shadow-accent)] outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
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
                  className="min-w-[92px] text-left text-sm font-semibold tabular-nums text-[var(--foreground)] sm:text-center"
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
                    className="h-11 w-full cursor-pointer accent-[var(--accent)]"
                  />
                </div>
                <button
                  type="button"
                  aria-label={muteLabel}
                  title={muteLabel}
                  onClick={handleNarrationMuteToggle}
                  className="grid size-11 place-items-center rounded-full text-[var(--foreground)] outline-none transition hover:bg-[var(--surface)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
            /*
              An empty transport, not a fake one. This branch used to draw a
              22-bar waveform with fifteen bars "played" and the readout
              "12:45 / 35:20" - a recording that does not exist, over a course
              with nothing published. Nothing here is playing, so nothing here
              pretends to be.
            */
            <div
              data-uais-learning-audio-controls="unavailable"
              role="status"
              className="flex min-h-16 items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-center text-sm leading-6 text-[var(--muted)]"
            >
              {locale === "zh-CN"
                ? "本课程暂无讲解音频。"
                : "This course has no narration audio yet."}
            </div>
          )}
        </div>

        <div
          data-uais-learning-segment-controls="compact"
          className="grid min-w-0 grid-cols-[44px_44px_1px_auto_minmax(0,1fr)] items-center justify-end gap-2 sm:pl-4 xl:flex-1 xl:basis-[260px]"
        >
          <button
            type="button"
            onClick={onPreviousPublishedSlide}
            disabled={!canShowPrevious}
            className={[
              "grid size-11 place-items-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              canShowPrevious
                ? "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                : "cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--placeholder)]",
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
              "grid size-11 place-items-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              canShowNext
                ? "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                : "cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--placeholder)]",
            ].join(" ")}
            aria-label={locale === "zh-CN" ? "下一段" : "Next"}
          >
            <CaretRight size={18} weight="bold" />
          </button>
          <span className="h-9 w-px bg-[var(--border)]" />
          {/* Disabled with the rest of the transport when there is no audio to
              set a rate on, rather than reporting a speed for silence. */}
          <button
            className={[
              "inline-flex h-11 items-center justify-center rounded-lg border px-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              publishedPlayback
                ? "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                : "cursor-not-allowed border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--placeholder)]",
            ].join(" ")}
            type="button"
            disabled={!publishedPlayback}
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
            disabled={!publishedPlayback?.slides.length}
            title={locale === "zh-CN" ? "学习工具" : "Study Tools"}
            onClick={onOpenStudyTools}
            className={[
              "inline-flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              studyToolsOpen
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]",
            ].join(" ")}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <GearSix size={17} weight="duotone" className="shrink-0" />
              <span className="truncate">{locale === "zh-CN" ? "学习工具" : "Study Tools"}</span>
            </span>
            <span
              aria-hidden="true"
              className="hidden min-w-0 truncate text-xs font-medium text-[var(--muted)] min-[1440px]:inline"
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
