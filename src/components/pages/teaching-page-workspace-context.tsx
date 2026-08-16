"use client";

// Workspace-entry context panel for the teacher workspace (Phase 3 decomposition of
// teaching-page.tsx). Extracted verbatim from the renderWorkspaceContext helper; the
// closed-over derived values and locale are now same-named props.
//
// Plan E9 added the course selector. This panel already claimed to show the
// "selected course", but nothing could select one: the state had no setter, so the
// panel was permanently empty and every inline operation quietly ran against
// `courseCards[0]`. The picker is here, beside the claim it makes true.

import { localizedText } from "@/components/ui/localized-text";
import { teacherSidebarItems } from "@/data/uais";
import type { TeacherCourse } from "@/data/uais";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import { extractCourseSemester } from "@/lib/teaching/course-readback";
import type { TeacherCourseAction } from "./teaching-page-types";

type WorkspaceContextProps = {
  locale: Locale;
  activeWorkspaceItem: (typeof teacherSidebarItems)[number];
  courseCards: TeacherCourse[];
  selectedCourseAction: { courseId: string; action: TeacherCourseAction } | undefined;
  selectedActionCourse: TeacherCourse | undefined;
  selectedCourseActionLabel: string | undefined;
  onSelectCourse: (courseId: string) => void;
};

export function WorkspaceContext({
  locale,
  activeWorkspaceItem,
  courseCards,
  selectedCourseAction,
  selectedActionCourse,
  selectedCourseActionLabel,
  onSelectCourse,
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
          <div className="min-w-0">
            <label
              htmlFor="teacher-workspace-course"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              {copy[locale].teaching.workspaceCourseSelectLabel}
            </label>
            <select
              id="teacher-workspace-course"
              value={selectedCourseAction?.courseId ?? ""}
              className="mt-2 h-11 w-full min-w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              onChange={(event) => onSelectCourse(event.target.value)}
            >
              <option value="">{copy[locale].teaching.workspaceCoursePlaceholder}</option>
              {courseCards.map((course) => (
                <option key={course.id} value={course.id}>
                  {/* Title AND term: two courses can share a name across
                      semesters, and a picker that cannot tell them apart is the
                      same wrong-course problem in a new place. */}
                  {`${localizedText(course.title, locale)} · ${extractCourseSemester(course, locale)}`}
                </option>
              ))}
            </select>
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
