"use client";

// Learning-group (chatroom group) management panel + dialog for the teacher
// course-settings workspace (Phase 4). The panel lists the persisted groups of
// one course with their member chips, an "Observe" deep link into the group's
// read-only chatroom room, and create / edit / rename / delete entries. All
// mutations are delegated to the receipt-and-readback handlers in
// `use-teaching-learning-groups.tsx`; this file only renders and validates the
// draft client-side against the same 2..12 member bounds the server enforces.
//
// Plan E9 added the three things a class-sized course needed: an auto-split
// control that calls the server's own partition rather than making the teacher
// build 40 groups by hand, an "already grouped" badge in the member picker (the
// server refuses a student who is in another group, and the picker used to offer
// them anyway), and a name filter, because 200 checkboxes with no search is not a
// list anyone can use.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye } from "@phosphor-icons/react/dist/ssr/Eye";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { localizedText } from "@/components/ui/localized-text";
import type { TeacherCourse } from "@/data/uais";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import type {
  TeacherClassItem,
  TeacherClassMembershipItem,
} from "@/lib/teaching/course-readback";
import type { TeacherGroupSuggestionDraft } from "./group-suggestion-review";
import {
  learningGroupMaxMembers,
  learningGroupMinMembers,
  type TeachingLearningGroupDraft,
  type TeachingLearningGroupItem,
  type TeachingLearningGroupPatch,
} from "./use-teaching-learning-groups";

// A starting value for the box, not a constraint: the server accepts anything in
// the same 2..12 range a hand-built group may hold.
export const defaultAutoSplitGroupSize = 5;

export type ApprovedCourseMember = {
  studentId: string;
  studentDisplayName: string;
  classId: string;
};

type LearningGroupDialogState =
  | {
      mode: "create";
      suggestion?: TeacherGroupSuggestionDraft["suggestedGroups"][number];
    }
  | { mode: "edit"; group: TeachingLearningGroupItem };

export function createLearningGroupChatroomHref(group: {
  courseId: string;
  groupId: string;
}) {
  const params = new URLSearchParams({
    courseId: group.courseId,
    groupId: group.groupId,
  });
  return `/learning/chatroom?${params.toString()}`;
}

// Approved memberships are the only assignable roster: the server rejects any
// member without an approved membership in the course (and class when the group
// is class-scoped), so the picker never offers a pending or rejected student.
export function createApprovedCourseMembers(
  classes: TeacherClassItem[],
  membershipsByClass: Record<string, TeacherClassMembershipItem[]>,
): ApprovedCourseMember[] {
  const seenStudentIds = new Set<string>();
  return classes.flatMap((classItem) =>
    (membershipsByClass[classItem.id] ?? [])
      .filter((membership) => membership.membershipStatus === "approved")
      .flatMap((membership) => {
        if (seenStudentIds.has(membership.studentId)) {
          return [];
        }
        seenStudentIds.add(membership.studentId);
        return [
          {
            studentId: membership.studentId,
            studentDisplayName: membership.studentDisplayName,
            classId: classItem.id,
          },
        ];
      }),
  );
}

export function LearningGroupManager({
  course,
  classes,
  membershipsByClass,
  groups,
  status,
  isOpen,
  locale,
  onToggle,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onAutoSplitGroups,
  pendingSuggestion,
  onSuggestionApplied,
}: {
  course: TeacherCourse;
  classes: TeacherClassItem[];
  membershipsByClass: Record<string, TeacherClassMembershipItem[]>;
  groups: TeachingLearningGroupItem[];
  status?: string;
  isOpen: boolean;
  locale: Locale;
  onToggle: () => void;
  onCreateGroup: (draft: TeachingLearningGroupDraft) => Promise<void>;
  onUpdateGroup: (groupId: string, patch: TeachingLearningGroupPatch) => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onAutoSplitGroups: (input: { groupSize: number }) => Promise<void>;
  pendingSuggestion?: TeacherGroupSuggestionDraft;
  onSuggestionApplied?: (suggestionKey: string) => void;
}) {
  const t = copy[locale].teaching;
  const courseTitle = localizedText(course.title, locale);
  const [dialogState, setDialogState] = useState<LearningGroupDialogState>();
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const [autoSplitSize, setAutoSplitSize] = useState(String(defaultAutoSplitGroupSize));
  const [isAutoSplitting, setIsAutoSplitting] = useState(false);
  const approvedMembers = useMemo(
    () => createApprovedCourseMembers(classes, membershipsByClass),
    [classes, membershipsByClass],
  );
  // Which group already holds each student, by student id. The server refuses a
  // second group for the same student in the same course, so this is the picker
  // showing the rule instead of the teacher discovering it at submit time.
  const groupNamesByStudentId = useMemo(
    () => createGroupNamesByStudentId(groups),
    [groups],
  );
  const parsedAutoSplitSize = Number(autoSplitSize.trim());
  const isAutoSplitSizeValid =
    Number.isSafeInteger(parsedAutoSplitSize) &&
    parsedAutoSplitSize >= learningGroupMinMembers &&
    parsedAutoSplitSize <= learningGroupMaxMembers;
  const ungroupedMemberCount = approvedMembers.filter(
    (member) => !groupNamesByStudentId[member.studentId],
  ).length;
  const approvedMemberIds = useMemo(
    () => new Set(approvedMembers.map((member) => member.studentId)),
    [approvedMembers],
  );
  const reviewableSuggestedGroups =
    pendingSuggestion?.courseId === course.id
      ? pendingSuggestion.suggestedGroups.map((suggestion) => {
          const eligibleMemberCount = suggestion.members.filter(
            (member) =>
              approvedMemberIds.has(member.studentId) &&
              !groupNamesByStudentId[member.studentId],
          ).length;
          return {
            ...suggestion,
            unavailableMemberCount: suggestion.members.length - eligibleMemberCount,
          };
        })
      : [];

  async function runAutoSplit() {
    if (!isAutoSplitSizeValid || isAutoSplitting) {
      return;
    }
    setIsAutoSplitting(true);
    try {
      await onAutoSplitGroups({ groupSize: parsedAutoSplitSize });
    } catch {
      // The handler already published the failure into the panel status line;
      // rethrowing here would only surface an unhandled rejection.
    } finally {
      setIsAutoSplitting(false);
    }
  }

  async function confirmDeleteGroup(groupId: string) {
    setDeleteError(undefined);
    try {
      await onDeleteGroup(groupId);
      setPendingDeleteGroupId(undefined);
    } catch (error) {
      setDeleteError(error instanceof Error && error.message ? error.message : t.groupSaveFailed);
    }
  }

  return (
    <div
      className="mt-5 border-t border-[var(--border)] pt-4"
      data-uais-learning-group-panel={course.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UsersThree size={20} weight="duotone" className="text-[var(--accent)]" />
          <h4 className="text-base font-semibold text-[var(--foreground)]">
            {t.groupPanelTitle}
          </h4>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]">
            {groups.length}
          </span>
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={
            locale === "zh-CN"
              ? `管理${courseTitle}的小组`
              : `Manage groups for ${courseTitle}`
          }
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={onToggle}
        >
          {isOpen ? t.groupHide : t.groupManage}
        </button>
      </div>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t.groupPanelSummary}</p>

      {reviewableSuggestedGroups.length > 0 ? (
        <section
          aria-label={
            locale === "zh-CN" ? "待教师复核的分组建议" : "Group suggestions awaiting teacher review"
          }
          data-uais-pending-group-suggestions={pendingSuggestion?.receiptId}
          className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-4"
        >
          <h5 className="text-sm font-semibold text-[var(--foreground)]">
            {locale === "zh-CN"
              ? "待教师复核的分组建议"
              : "Group suggestions awaiting teacher review"}
          </h5>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {locale === "zh-CN"
              ? "建议尚未分配任何学生。请逐组打开草稿，核对名称和成员，再由教师提交创建。"
              : "No students have been assigned. Open each draft, review its name and members, then submit it as the teacher."}
          </p>
          <div className="mt-3 space-y-2">
            {reviewableSuggestedGroups.map((suggestion) => (
              <article
                key={suggestion.suggestionKey}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {suggestion.groupName}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {suggestion.members.map((member) => member.studentDisplayName).join("、")}
                  </p>
                  {suggestion.unavailableMemberCount > 0 ? (
                    <p className="mt-1 text-sm font-semibold text-rose-700 dark:text-rose-200">
                      {locale === "zh-CN"
                        ? `${suggestion.unavailableMemberCount} 名建议成员状态已变化，请重新生成分组建议。`
                        : `${suggestion.unavailableMemberCount} suggested member(s) changed status. Generate suggestions again.`}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={suggestion.unavailableMemberCount > 0}
                  aria-label={
                    suggestion.unavailableMemberCount > 0
                      ? locale === "zh-CN"
                        ? `${suggestion.groupName}成员状态已变化，不能打开复核草稿`
                        : `${suggestion.groupName} has changed members and cannot be reviewed`
                      : locale === "zh-CN"
                        ? `复核并创建${suggestion.groupName}`
                        : `Review and create ${suggestion.groupName}`
                  }
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => setDialogState({ mode: "create", suggestion })}
                >
                  <PencilSimple size={16} weight="bold" />
                  {locale === "zh-CN" ? "复核草稿" : "Review draft"}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {isOpen ? (
        <div className="mt-4 space-y-3">
          {status ? (
            <p
              role="status"
              className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent)]"
            >
              {status}
            </p>
          ) : null}

          <button
            type="button"
            disabled={approvedMembers.length < learningGroupMinMembers}
            aria-label={
              locale === "zh-CN"
                ? `为${courseTitle}新建小组`
                : `New group for ${courseTitle}`
            }
            className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setDialogState({ mode: "create" })}
          >
            <Plus size={17} weight="bold" />
            {t.groupNew}
          </button>

          {approvedMembers.length < learningGroupMinMembers ? (
            <p className="text-sm leading-6 text-[var(--muted)]">{t.groupNoApprovedMembers}</p>
          ) : null}

          <div
            data-uais-learning-group-auto-split={course.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          >
            <h5 className="text-sm font-semibold text-[var(--foreground)]">
              {t.groupAutoSplitTitle}
            </h5>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t.groupAutoSplitSummary}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor={`learning-group-auto-split-size-${course.id}`}
                  className="block text-sm font-semibold text-[var(--foreground)]"
                >
                  {t.groupAutoSplitSizeLabel}
                </label>
                <input
                  id={`learning-group-auto-split-size-${course.id}`}
                  type="number"
                  inputMode="numeric"
                  min={learningGroupMinMembers}
                  max={learningGroupMaxMembers}
                  value={autoSplitSize}
                  className="mt-2 h-10 w-28 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                  onChange={(event) => setAutoSplitSize(event.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={
                  !isAutoSplitSizeValid ||
                  isAutoSplitting ||
                  ungroupedMemberCount < learningGroupMinMembers
                }
                aria-label={
                  locale === "zh-CN"
                    ? `为${courseTitle}自动分组`
                    : `Auto-split ${courseTitle} into groups`
                }
                className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 text-sm font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void runAutoSplit()}
              >
                <UsersThree size={17} weight="bold" />
                {isAutoSplitting ? t.groupAutoSplitRunning : t.groupAutoSplitAction}
              </button>
            </div>
            {isAutoSplitSizeValid ? null : (
              <p role="alert" className="mt-2 text-sm font-semibold text-rose-600">
                {t.groupAutoSplitSizeInvalid}
              </p>
            )}
            {isAutoSplitSizeValid && ungroupedMemberCount < learningGroupMinMembers ? (
              <p className="mt-2 text-sm text-[var(--muted)]">{t.groupAutoSplitNoEligible}</p>
            ) : null}
          </div>

          {groups.length > 0 ? (
            <div className="space-y-3">
              {groups.map((group) => (
                <article
                  key={group.groupId}
                  data-uais-learning-group={group.groupId}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h5 className="text-base font-semibold text-[var(--foreground)]">
                        {group.groupName}
                      </h5>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {t.groupClassLabel}：
                        {resolveLearningGroupClassName(group, classes, locale)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={createLearningGroupChatroomHref(group)}
                        aria-label={
                          locale === "zh-CN"
                            ? `进入${group.groupName}聊天室`
                            : `Open the ${group.groupName} chatroom`
                        }
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-elevated)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        <Eye size={16} weight="bold" />
                        {t.groupObserve}
                      </Link>
                      <button
                        type="button"
                        aria-label={
                          locale === "zh-CN"
                            ? `编辑${group.groupName}`
                            : `Edit ${group.groupName}`
                        }
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-elevated)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        onClick={() => setDialogState({ mode: "edit", group })}
                      >
                        <PencilSimple size={16} weight="bold" />
                        {t.groupEdit}
                      </button>
                      <button
                        type="button"
                        aria-label={
                          locale === "zh-CN"
                            ? `删除${group.groupName}`
                            : `Delete ${group.groupName}`
                        }
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 outline-none transition hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-400 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                        onClick={() => {
                          setDeleteError(undefined);
                          setPendingDeleteGroupId(group.groupId);
                        }}
                      >
                        <Trash size={16} weight="bold" />
                        {t.groupDelete}
                      </button>
                    </div>
                  </div>

                  <ul className="mt-3 flex flex-wrap gap-2" aria-label={t.groupMembersLabel}>
                    {group.members.map((member) => (
                      <li
                        key={member.studentId}
                        className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1 text-sm font-medium text-[var(--foreground)]"
                      >
                        {member.studentDisplayName}
                      </li>
                    ))}
                  </ul>

                  {pendingDeleteGroupId === group.groupId ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          aria-label={
                            locale === "zh-CN"
                              ? `确认删除${group.groupName}`
                              : `Confirm deleting ${group.groupName}`
                          }
                          className="inline-flex h-9 items-center rounded-full bg-rose-600 px-4 text-sm font-semibold text-white outline-none transition hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-400"
                          onClick={() => void confirmDeleteGroup(group.groupId)}
                        >
                          {t.groupDeleteConfirm}
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-9 items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          onClick={() => {
                            setDeleteError(undefined);
                            setPendingDeleteGroupId(undefined);
                          }}
                        >
                          {t.groupCancel}
                        </button>
                      </div>
                      {deleteError ? (
                        <p role="alert" className="mt-2 font-semibold">
                          {deleteError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--muted)]">{t.groupEmpty}</p>
          )}
        </div>
      ) : null}

      {dialogState ? (
        <LearningGroupDialog
          course={course}
          classes={classes}
          approvedMembers={approvedMembers}
          groupNamesByStudentId={groupNamesByStudentId}
          locale={locale}
          group={dialogState.mode === "edit" ? dialogState.group : undefined}
          suggestedGroupName={
            dialogState.mode === "create" ? dialogState.suggestion?.groupName : undefined
          }
          suggestedMemberIds={
            dialogState.mode === "create"
              ? dialogState.suggestion?.members.map((member) => member.studentId)
              : undefined
          }
          onCancel={() => setDialogState(undefined)}
          onSubmit={async (draft) => {
            if (dialogState.mode === "edit") {
              await onUpdateGroup(dialogState.group.groupId, {
                groupName: draft.groupName,
                memberIds: draft.memberIds,
              });
            } else {
              await onCreateGroup(draft);
              if (dialogState.suggestion) {
                onSuggestionApplied?.(dialogState.suggestion.suggestionKey);
              }
            }
            setDialogState(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

// One group per student per course, so the last write wins here only if the
// server let two exist - which it does not.
function createGroupNamesByStudentId(groups: TeachingLearningGroupItem[]) {
  return groups.reduce<Record<string, string>>((names, group) => {
    for (const member of group.members) {
      names[member.studentId] = group.groupName;
    }
    return names;
  }, {});
}

function resolveLearningGroupClassName(
  group: TeachingLearningGroupItem,
  classes: TeacherClassItem[],
  locale: Locale,
) {
  if (!group.classId) {
    return copy[locale].teaching.groupClassAll;
  }
  return (
    classes.find((classItem) => classItem.id === group.classId)?.name ?? group.classId
  );
}

export function LearningGroupDialog({
  course,
  classes,
  approvedMembers,
  groupNamesByStudentId,
  group,
  locale,
  // The verified suggestion panel opens this same dialog only after an explicit
  // teacher review click. Suggested values remain editable and submit through
  // the normal receipt-and-readback create handler; generation itself persists
  // no learning group. Auto-split remains a separate, explicitly labelled write.
  suggestedMemberIds,
  suggestedGroupName,
  onCancel,
  onSubmit,
}: {
  course: TeacherCourse;
  classes: TeacherClassItem[];
  approvedMembers: ApprovedCourseMember[];
  // Group name per already-grouped student id; the picker badges them and, for a
  // new group, refuses to select them at all.
  groupNamesByStudentId: Record<string, string>;
  group?: TeachingLearningGroupItem;
  locale: Locale;
  suggestedMemberIds?: string[];
  suggestedGroupName?: string;
  onCancel: () => void;
  onSubmit: (draft: TeachingLearningGroupDraft) => Promise<void>;
}) {
  const t = copy[locale].teaching;
  const isEditing = Boolean(group);
  const [groupName, setGroupName] = useState(group?.groupName ?? suggestedGroupName ?? "");
  const [classId, setClassId] = useState(group?.classId ?? "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    () => group?.members.map((member) => member.studentId) ?? suggestedMemberIds ?? [],
  );
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [memberFilter, setMemberFilter] = useState("");

  // A class-scoped group may only hold members of that class, mirroring the
  // server-side approved-membership lookup.
  const classScopedMembers = classId
    ? approvedMembers.filter((member) => member.classId === classId)
    : approvedMembers;
  const normalizedMemberFilter = memberFilter.trim().toLowerCase();
  const selectableMembers = normalizedMemberFilter
    ? classScopedMembers.filter(
        (member) =>
          member.studentDisplayName.toLowerCase().includes(normalizedMemberFilter) ||
          member.studentId.toLowerCase().includes(normalizedMemberFilter),
      )
    : classScopedMembers;
  // A member of THIS group is not "already grouped" - the conflict is only with
  // some other group of the same course, which is exactly what the server checks.
  const isMemberGroupedElsewhere = (studentId: string) =>
    Boolean(groupNamesByStudentId[studentId]) &&
    !group?.members.some((member) => member.studentId === studentId);
  const memberCount = selectedMemberIds.length;
  const isMemberCountValid =
    memberCount >= learningGroupMinMembers && memberCount <= learningGroupMaxMembers;
  const isReady = groupName.trim().length > 0 && isMemberCountValid;

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onCancel();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onCancel]);

  function toggleMember(studentId: string) {
    setFormError(undefined);
    if (isMemberGroupedElsewhere(studentId)) {
      setFormError(t.groupMemberAlreadyGrouped);
      return;
    }
    setSelectedMemberIds((currentMemberIds) =>
      currentMemberIds.includes(studentId)
        ? currentMemberIds.filter((memberId) => memberId !== studentId)
        : [...currentMemberIds, studentId],
    );
  }

  async function submitLearningGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || isSubmitting) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);
    try {
      await onSubmit({
        groupName: groupName.trim(),
        ...(classId ? { classId } : {}),
        memberIds: selectedMemberIds,
      });
    } catch (error) {
      setFormError(
        error instanceof Error && error.message ? error.message : t.groupSaveFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-10 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-group-dialog-title"
        data-uais-learning-group-dialog={isEditing ? "edit" : "create"}
        className="w-full max-w-3xl overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_28px_80px_var(--shadow)]"
        onSubmit={submitLearningGroup}
      >
        <header className="flex min-h-16 items-center justify-between border-b border-[var(--border)] px-6">
          <div>
            <h2 id="learning-group-dialog-title" className="text-2xl font-semibold">
              {isEditing ? t.groupEdit : t.groupNew}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {localizedText(course.title, locale)}
            </p>
          </div>
          <button
            type="button"
            aria-label={
              locale === "zh-CN" ? "关闭小组弹窗" : "Close the group dialog"
            }
            disabled={isSubmitting}
            className="inline-flex size-10 items-center justify-center rounded-full text-[var(--muted)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55"
            onClick={onCancel}
          >
            <X size={26} weight="bold" />
          </button>
        </header>

        <div className="space-y-5 px-6 py-6">
          <div>
            <label
              htmlFor="learning-group-name"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              {t.groupNameLabel}
            </label>
            <input
              id="learning-group-name"
              value={groupName}
              className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              onChange={(event) => {
                setFormError(undefined);
                setGroupName(event.target.value);
              }}
            />
          </div>

          {isEditing ? null : (
            <div>
              <label
                htmlFor="learning-group-class"
                className="block text-sm font-semibold text-[var(--foreground)]"
              >
                {t.groupClassLabel}
              </label>
              <select
                id="learning-group-class"
                value={classId}
                className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                onChange={(event) => {
                  setFormError(undefined);
                  setClassId(event.target.value);
                  setSelectedMemberIds([]);
                }}
              >
                <option value="">{t.groupClassAll}</option>
                {classes.map((classItem) => (
                  <option key={classItem.id} value={classItem.id}>
                    {classItem.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <fieldset>
            <legend className="text-sm font-semibold text-[var(--foreground)]">
              {t.groupMembersLabel}
            </legend>
            <p className="mt-1 text-sm text-[var(--muted)]">{t.groupMemberHint}</p>
            <p className="mt-1 text-sm font-semibold text-[var(--accent)]">
              {t.groupSelectedCount}
              {`: ${memberCount} / ${learningGroupMaxMembers}`}
            </p>
            <div className="mt-3">
              <label htmlFor="learning-group-member-filter" className="sr-only">
                {t.groupMemberFilterLabel}
              </label>
              <input
                id="learning-group-member-filter"
                value={memberFilter}
                aria-label={t.groupMemberFilterLabel}
                placeholder={t.groupMemberFilterPlaceholder}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                onChange={(event) => setMemberFilter(event.target.value)}
              />
            </div>
            {classScopedMembers.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">{t.groupNoApprovedMembers}</p>
            ) : selectableMembers.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">{t.groupMemberFilterEmpty}</p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {selectableMembers.map((member) => {
                  const groupedElsewhere = isMemberGroupedElsewhere(member.studentId);
                  return (
                    <label
                      key={member.studentId}
                      data-uais-learning-group-member-option={member.studentId}
                      className={[
                        "flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)]",
                        groupedElsewhere ? "opacity-70" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <input
                        type="checkbox"
                        value={member.studentId}
                        checked={selectedMemberIds.includes(member.studentId)}
                        disabled={groupedElsewhere}
                        className="size-4"
                        onChange={() => toggleMember(member.studentId)}
                      />
                      <span className="min-w-0 truncate">{member.studentDisplayName}</span>
                      {groupedElsewhere ? (
                        <span
                          data-uais-learning-group-member-grouped={member.studentId}
                          className="ml-auto shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]"
                        >
                          {`${t.groupMemberGroupedBadge}: ${groupNamesByStudentId[member.studentId]}`}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
            {memberCount > 0 && !isMemberCountValid ? (
              <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">
                {memberCount < learningGroupMinMembers
                  ? t.groupMembersBelowMinimum
                  : t.groupMembersAboveMaximum}
              </p>
            ) : null}
          </fieldset>

          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
            >
              {formError}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-4 border-t border-[var(--border)] px-6 py-5">
          <button
            type="button"
            disabled={isSubmitting}
            className="inline-flex h-11 min-w-28 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-6 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onCancel}
          >
            {t.groupCancel}
          </button>
          <button
            type="submit"
            disabled={!isReady || isSubmitting}
            className="inline-flex h-11 min-w-28 items-center justify-center rounded-full bg-[var(--accent)] px-6 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? t.groupSaving : isEditing ? t.groupSave : t.groupCreate}
          </button>
        </footer>
      </form>
    </div>
  );
}
