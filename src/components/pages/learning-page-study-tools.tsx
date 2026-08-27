"use client";

// Study-tools panel for the learner workspace (Phase 3 decomposition of
// learning-page.tsx): the notes / checkpoint / concepts study views and their
// tabbed container. Presentational, driven by SlideStudyContent; no chatroom coupling.



import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { GearSix } from "@phosphor-icons/react/dist/ssr/GearSix";
import { Notebook } from "@phosphor-icons/react/dist/ssr/Notebook";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Target } from "@phosphor-icons/react/dist/ssr/Target";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import type { Locale } from "@/i18n/copy";
import type { SlideStudyContent, StudyToolView } from "./learning-page-helpers";

export function StudyToolsPanel({
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
        className="fixed inset-0 z-40 bg-[var(--foreground)]/35 backdrop-blur-[1px] xl:hidden"
      />
      <section
        id="learning-tools-panel"
        role="dialog"
        aria-label={zh ? "学习工具" : "Study Tools"}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_-22px_48px_var(--shadow-strong)] xl:static xl:z-auto xl:max-h-none xl:rounded-none xl:border-0 xl:bg-transparent xl:shadow-none"
      >
        <div className="border-b border-[var(--border)] bg-[var(--surface)] p-4 xl:bg-transparent xl:px-0 xl:pt-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]">
                <GearSix size={17} weight="duotone" />
                {zh ? "学习工具" : "Study Tools"}
              </p>
              <p className="mt-1 truncate text-xs font-medium text-[var(--muted)]">
                {zh ? "记录、检查和复习当前页" : "Capture, check, and review this slide"}
              </p>
            </div>
            <button
              type="button"
              aria-label={zh ? "关闭学习工具" : "Close study tools"}
              onClick={onClose}
              className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] outline-none transition hover:border-[var(--accent-border)] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <X size={17} weight="bold" />
            </button>
          </div>

          <div
            role="group"
            aria-label={zh ? "学习工具栏目切换" : "Study tools switcher"}
            className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-1"
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
                    "inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-[0_8px_18px_var(--shadow-accent)]"
                      : "border-transparent bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]",
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
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
          {studyContent.slideLabel}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-[var(--foreground)]">
          {zh ? "本页笔记" : "Slide Notes"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{studyContent.slideTitle}</p>
      </div>

      <div className="mt-4 space-y-4">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {zh ? "学习要点" : "Study Takeaways"}
          </h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
            {studyContent.takeaways.map((takeaway) => (
              <li key={takeaway} className="flex gap-2">
                <CheckCircle size={17} weight="duotone" className="mt-1 shrink-0 text-[var(--accent)]" />
                <span>{takeaway}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {zh ? "讲解线索" : "Narration Cue"}
          </h3>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{studyContent.narrationCue}</p>
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
      <h2 className="text-lg font-semibold text-[var(--foreground)]">
        {zh ? "学习检查点" : "Study Checkpoint"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {zh
          ? `围绕「${studyContent.slideTitle}」完成自检。`
          : `Check your understanding of "${studyContent.slideTitle}".`}
      </p>
      <div className="mt-4 space-y-3">
        {studyContent.checkpoints.map((checkpoint) => {
          const expanded = expandedCheckpointId === checkpoint.id;
          return (
            <div key={checkpoint.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => onToggleCheckpoint(checkpoint.id)}
                className="flex w-full items-start justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold leading-6 text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-elevated)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <span>{checkpoint.question}</span>
                <CaretRight
                  size={17}
                  weight="bold"
                  className={[
                    "mt-1 shrink-0 text-[var(--accent)] transition",
                    expanded ? "rotate-90" : "",
                  ].join(" ")}
                />
              </button>
              {expanded ? (
                <div className="border-t border-[var(--border)] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
                  <p className="font-semibold text-[var(--accent)]">
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
      <h2 className="text-lg font-semibold text-[var(--foreground)]">
        {zh ? "关键概念" : "Key Concepts"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {zh
          ? `本页共有 ${studyContent.concepts.length} 个概念需要钉住。`
          : `${studyContent.concepts.length} concepts are pinned for this slide.`}
      </p>
      <div className="mt-4 space-y-3">
        {studyContent.concepts.map((concept) => (
          <article
            key={concept.title}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_8px_18px_var(--shadow)]"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Sparkle size={18} weight="duotone" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{concept.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{concept.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
