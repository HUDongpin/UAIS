"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { FilePdf } from "@phosphor-icons/react/dist/ssr/FilePdf";
import { PlayCircle } from "@phosphor-icons/react/dist/ssr/PlayCircle";
import type { Locale } from "@/i18n/copy";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import {
  courseDirectoryChapters,
  courseDirectoryLessonTimes,
} from "./learning-page-content";
import {
  createCompletedNarrationStorageKey,
  formatSlideDurationLabel,
  getPublishedPlaybackStageCopy,
  readCompletedNarrationSlideIds,
  type PublishedPlaybackError,
} from "./learning-page-helpers";

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
export function CourseDirectoryView({
  locale,
  learnerAccount,
  publishedPlayback,
  publishedPlaybackError,
  activePublishedSlide,
  onSelectPublishedSlide,
}: {
  locale: Locale;
  learnerAccount?: string;
  publishedPlayback?: LearningPptPlaybackManifest;
  publishedPlaybackError?: PublishedPlaybackError;
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

  if (
    publishedPlaybackError === "access-denied" ||
    publishedPlaybackError === "auth-required"
  ) {
    const stageCopy = getPublishedPlaybackStageCopy(locale, publishedPlaybackError);
    return (
      <div data-uais-learning-outline="unavailable">
        <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <p className="text-sm font-semibold text-[var(--foreground)]">{stageCopy.title}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{stageCopy.description}</p>
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
