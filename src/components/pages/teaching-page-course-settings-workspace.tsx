"use client";

// Course-settings teacher workspace panel (Phase 3 decomposition of teaching-page.tsx).
// Extracted verbatim from renderCourseSettingsWorkspace; closed-over state, derived
// values, setters, and handlers are same-named props, so the render body is unchanged.



import { type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { LearningGroupManager } from "@/components/teaching/learning-group-workspace";
import {
  getTeachingCourseActionHref,
} from "@/components/teaching/teaching-operation-data";
import type { TeachingOperationId } from "@/components/teaching/teaching-operation-data";
import { useTeachingLearningGroupsWorkspace } from "@/components/teaching/use-teaching-learning-groups";
import { localizedText } from "@/components/ui/localized-text";
import { teacherSidebarItems } from "@/data/uais";
import type { TeacherCourse } from "@/data/uais";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import type {
  CourseSettingsDraftFieldInput,
  CourseSettingsDraftValues,
  TeacherClassItem,
  TeacherClassMembershipItem,
} from "@/lib/teaching/course-readback";
import { CourseClassManager } from "./teaching-page-dialogs";
import { InlineWorkspaceActionButtons } from "./teaching-page-inline-workspace-action-buttons";
import { InlineWorkspaceStatus } from "./teaching-page-inline-workspace-status";
import { WorkspaceContext } from "./teaching-page-workspace-context";
import type {
  InlineWorkspaceAlertNotificationStatus,
  InlineWorkspaceAlertStatus,
  InlineWorkspaceAuditStatus,
  InlineWorkspaceRollbackStatus,
  TeacherCourseAction,
} from "./teaching-page-types";

type CourseSettingsWorkspaceProps = {
  locale: Locale;
  t: (typeof copy)[Locale];
  activeWorkspaceItem: (typeof teacherSidebarItems)[number];
  activeCourseSettingsCourse: TeacherCourse | undefined;
  // Resolved display values: sparse draft fields backfilled from the persisted
  // course at the current locale.
  activeCourseSettingsDraft: CourseSettingsDraftValues | undefined;
  courseCards: TeacherCourse[];
  courseClasses: Record<string, TeacherClassItem[]>;
  classMemberships: Record<string, TeacherClassMembershipItem[]>;
  // Server-computed chatroom-groups feature state (plan D9), read off the same
  // signed teacher course list this workspace already loads.
  learningChatroomGroupsEnabled: boolean;
  membershipApprovalStatuses: Record<string, string>;
  // Plan E9 roster lifecycle: bulk approval per class, reject/remove per row.
  membershipLifecycleStatuses: Record<string, string>;
  classRosterStatuses: Record<string, string>;
  pendingMembershipIds: string[];
  pendingBulkApprovalClassIds: string[];
  inlineWorkspaceStatuses: Partial<Record<TeachingOperationId, string>>;
  inlineWorkspaceAuditStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAuditStatus>>;
  inlineWorkspaceAlertStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceAlertStatus>>;
  inlineWorkspaceAlertNotificationStatuses: Partial<
    Record<TeachingOperationId, InlineWorkspaceAlertNotificationStatus>
  >;
  inlineWorkspaceRollbackStatuses: Partial<Record<TeachingOperationId, InlineWorkspaceRollbackStatus>>;
  selectedActionCourse: TeacherCourse | undefined;
  selectedCourseActionLabel: string | undefined;
  selectedCourseAction: { courseId: string; action: TeacherCourseAction } | undefined;
  onSelectCourseAction: (courseId: string) => void;
  setIsNewCourseOpen: Dispatch<SetStateAction<boolean>>;
  setNewClassCourseId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedClassInvitation: Dispatch<SetStateAction<TeacherClassItem | undefined>>;
  approveClassMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  approveAllPendingMemberships: (
    classItem: TeacherClassItem,
    pendingMemberships: TeacherClassMembershipItem[],
  ) => void;
  rejectMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  removeMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  // Raw typed strings: the hook stamps the current locale onto each edited field.
  updateCourseSettingsDraft: (course: TeacherCourse, patch: CourseSettingsDraftFieldInput) => void;
  queueInlineWorkspaceAuditAlertNotifications: (
    operationId: TeachingOperationId,
    notificationRoute?: string,
  ) => void;
  runInlineWorkspaceAction: (
    operationId: TeachingOperationId,
    actionSlot: "primary" | "secondary",
  ) => void;
  runInlineWorkspaceRollback: (input: {
    operationId: TeachingOperationId;
    recordId: string;
    courseId?: string;
  }) => void;
};

export function CourseSettingsWorkspace({
  locale,
  t,
  activeWorkspaceItem,
  activeCourseSettingsCourse,
  activeCourseSettingsDraft,
  courseCards,
  courseClasses,
  classMemberships,
  learningChatroomGroupsEnabled,
  membershipApprovalStatuses,
  membershipLifecycleStatuses,
  classRosterStatuses,
  pendingMembershipIds,
  pendingBulkApprovalClassIds,
  inlineWorkspaceStatuses,
  inlineWorkspaceAuditStatuses,
  inlineWorkspaceAlertStatuses,
  inlineWorkspaceAlertNotificationStatuses,
  inlineWorkspaceRollbackStatuses,
  selectedActionCourse,
  selectedCourseActionLabel,
  selectedCourseAction,
  onSelectCourseAction,
  setIsNewCourseOpen,
  setNewClassCourseId,
  setSelectedClassInvitation,
  approveClassMembership,
  approveAllPendingMemberships,
  rejectMembership,
  removeMembership,
  updateCourseSettingsDraft,
  queueInlineWorkspaceAuditAlertNotifications,
  runInlineWorkspaceAction,
  runInlineWorkspaceRollback,
}: CourseSettingsWorkspaceProps) {
    // Learning-group state is owned here rather than threaded from the page shell:
    // the panel is a course-settings surface, and keeping the hook local means the
    // group readback only runs once a teacher actually opens a group panel. The
    // feature gate is the exception — it arrives as a prop off the workspace's
    // existing course-list read, because a probe of its own would add a request
    // to every teaching page load.
    const {
      learningGroupsByCourse,
      learningGroupStatuses,
      openLearningGroupCourseIds,
      toggleLearningGroupPanel,
      createLearningGroup,
      updateLearningGroup,
      deleteLearningGroup,
      autoSplitLearningGroups,
    } = useTeachingLearningGroupsWorkspace();

    return (
      <div
        className="space-y-5"
        data-uais-active-teaching-workspace="course-settings"
        data-uais-teaching-workspace-panel
      >
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-[var(--foreground)]">
                {locale === "zh-CN" ? "课程设置工作台" : "Course Settings Workspace"}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {locale === "zh-CN"
                  ? "维护课程档案、班级结构、学期节奏和学生端发布前检查。"
                  : "Maintain course profiles, class structures, term cadence, and student-facing release checks."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
                onClick={() => setIsNewCourseOpen(true)}
              >
                <Plus size={17} weight="bold" />
                {locale === "zh-CN" ? "新增课程" : "New Course"}
              </button>
              {<InlineWorkspaceActionButtons
              operationId={"course-settings"}
              locale={locale}
              inlineWorkspaceStatuses={inlineWorkspaceStatuses}
              isCourseChosen={Boolean(selectedCourseAction?.courseId)}
              runInlineWorkspaceAction={runInlineWorkspaceAction}
            />}
            </div>
          </div>

          {<WorkspaceContext
            locale={locale}
            activeWorkspaceItem={activeWorkspaceItem}
            courseCards={courseCards}
            selectedCourseAction={selectedCourseAction}
            selectedActionCourse={selectedActionCourse}
            selectedCourseActionLabel={selectedCourseActionLabel}
            onSelectCourse={onSelectCourseAction}
          />}
          {activeCourseSettingsCourse && activeCourseSettingsDraft ? (
            <div
              className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
              data-uais-course-settings-patch-form={activeCourseSettingsCourse.id}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="min-w-0">
                  <label
                    htmlFor={`course-settings-name-${activeCourseSettingsCourse.id}`}
                    className="block text-sm font-semibold text-[var(--foreground)]"
                  >
                    {locale === "zh-CN" ? "课程名称" : "Course Name"}
                  </label>
                  <input
                    id={`course-settings-name-${activeCourseSettingsCourse.id}`}
                    value={activeCourseSettingsDraft.courseName}
                    className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                    onChange={(event) =>
                      updateCourseSettingsDraft(activeCourseSettingsCourse, {
                        courseName: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor={`course-settings-semester-${activeCourseSettingsCourse.id}`}
                    className="block text-sm font-semibold text-[var(--foreground)]"
                  >
                    {locale === "zh-CN" ? "学期安排" : "Semester"}
                  </label>
                  <input
                    id={`course-settings-semester-${activeCourseSettingsCourse.id}`}
                    value={activeCourseSettingsDraft.semester}
                    className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                    onChange={(event) =>
                      updateCourseSettingsDraft(activeCourseSettingsCourse, {
                        semester: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="min-w-0 lg:col-span-2">
                  <label
                    htmlFor={`course-settings-description-${activeCourseSettingsCourse.id}`}
                    className="block text-sm font-semibold text-[var(--foreground)]"
                  >
                    {locale === "zh-CN" ? "课程说明" : "Course Description"}
                  </label>
                  <textarea
                    id={`course-settings-description-${activeCourseSettingsCourse.id}`}
                    value={activeCourseSettingsDraft.description}
                    rows={3}
                    className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium leading-6 text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                    onChange={(event) =>
                      updateCourseSettingsDraft(activeCourseSettingsCourse, {
                        description: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
          {<InlineWorkspaceStatus
            operationId="course-settings"
            locale={locale}
            inlineWorkspaceStatuses={inlineWorkspaceStatuses}
            inlineWorkspaceAuditStatuses={inlineWorkspaceAuditStatuses}
            inlineWorkspaceAlertStatuses={inlineWorkspaceAlertStatuses}
            inlineWorkspaceAlertNotificationStatuses={inlineWorkspaceAlertNotificationStatuses}
            inlineWorkspaceRollbackStatuses={inlineWorkspaceRollbackStatuses}
            runInlineWorkspaceRollback={runInlineWorkspaceRollback}
            queueInlineWorkspaceAuditAlertNotifications={queueInlineWorkspaceAuditAlertNotifications}
          />}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {courseCards.map((course) => (
              <article
                key={course.id}
                className={[
                  "rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4",
                  course.id.startsWith("teacher-new-") ? "md:col-span-2" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--foreground)]">
                      {localizedText(course.title, locale)}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-[var(--accent)]">
                      {localizedText(course.status, locale)}
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm font-semibold text-[var(--foreground)]">
                    {course.students}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                  {localizedText(course.currentFocus, locale)}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link
                    href={getTeachingCourseActionHref(
                      "course-settings",
                      course.id,
                      "manage",
                    )}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
                  >
                    {t.common.manageCourse}
                    <ArrowRight size={16} weight="bold" />
                  </Link>
                  <Link
                    href={getTeachingCourseActionHref("content", course.id, "continue")}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    {t.teaching.continue}
                  </Link>
                </div>
                <CourseClassManager
                  classes={courseClasses[course.id] ?? []}
                  membershipsByClass={classMemberships}
                  membershipApprovalStatuses={membershipApprovalStatuses}
                  membershipLifecycleStatuses={membershipLifecycleStatuses}
                  classRosterStatuses={classRosterStatuses}
                  pendingMembershipIds={pendingMembershipIds}
                  pendingBulkApprovalClassIds={pendingBulkApprovalClassIds}
                  course={course}
                  locale={locale}
                  onApproveMembership={approveClassMembership}
                  onApproveAllPendingMemberships={approveAllPendingMemberships}
                  onRejectMembership={rejectMembership}
                  onRemoveMembership={removeMembership}
                  onNewClass={() => setNewClassCourseId(course.id)}
                  onOpenInvitation={setSelectedClassInvitation}
                />
                {/* Plan D9: while `UAIS_LEARNING_CHATROOM_GROUPS_MODE` is off the
                    whole Group Collaboration surface stays hidden — panel, manage
                    toggle and the Observe deep links with it — so a dark
                    deployment never offers a room the chatroom API would refuse.
                    Only an explicit server `true` renders it; an unanswered or
                    failed course-list read keeps it hidden. */}
                {learningChatroomGroupsEnabled ? (
                  <LearningGroupManager
                    course={course}
                    classes={courseClasses[course.id] ?? []}
                    membershipsByClass={classMemberships}
                    groups={learningGroupsByCourse[course.id] ?? []}
                    status={learningGroupStatuses[course.id]}
                    isOpen={openLearningGroupCourseIds.includes(course.id)}
                    locale={locale}
                    onToggle={() => toggleLearningGroupPanel(course.id)}
                    onCreateGroup={(draft) => createLearningGroup(course.id, draft)}
                    onUpdateGroup={(groupId, patch) =>
                      updateLearningGroup(course.id, groupId, patch)
                    }
                    onDeleteGroup={(groupId) => deleteLearningGroup(course.id, groupId)}
                    onAutoSplitGroups={(input) => autoSplitLearningGroups(course.id, input)}
                  />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }
