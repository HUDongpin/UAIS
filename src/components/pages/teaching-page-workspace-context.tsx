"use client";

// Workspace-entry context panel for the teacher workspace (Phase 3 decomposition of
// teaching-page.tsx). Extracted verbatim from the renderWorkspaceContext helper; the
// closed-over derived values and locale are now same-named props, so the body is unchanged.

import { localizedText } from "@/components/ui/localized-text";
import { teacherSidebarItems } from "@/data/uais";
import type { TeacherCourse } from "@/data/uais";
import type { Locale } from "@/i18n/copy";
import type { TeacherCourseAction } from "./teaching-page-types";

type WorkspaceContextProps = {
  locale: Locale;
  activeWorkspaceItem: (typeof teacherSidebarItems)[number];
  selectedCourseAction: { courseId: string; action: TeacherCourseAction } | undefined;
  selectedActionCourse: TeacherCourse | undefined;
  selectedCourseActionLabel: string | undefined;
};

export function WorkspaceContext({
  locale,
  activeWorkspaceItem,
  selectedCourseAction,
  selectedActionCourse,
  selectedCourseActionLabel,
}: WorkspaceContextProps) {
    return (
      <div
        id="teacher-workspace-entry-panel"
        className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">
              {locale === "zh-CN" ? "当前入口" : "Current entry"}：
              {localizedText(activeWorkspaceItem.title, locale)}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {localizedText(activeWorkspaceItem.description, locale)}
            </p>
          </div>
          {selectedCourseAction && selectedActionCourse && selectedCourseActionLabel ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)]">
              <p className="font-semibold">
                {locale === "zh-CN" ? "已选择课程" : "Selected course"}：
                {localizedText(selectedActionCourse.title, locale)}
              </p>
              <p className="mt-1 text-[var(--muted)]">
                {locale === "zh-CN" ? "课程操作" : "Course action"}：
                {selectedCourseActionLabel}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
