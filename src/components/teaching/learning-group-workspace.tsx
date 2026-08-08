"use client";

// Learning-group (chatroom group) management panel + dialog for the teacher
// course-settings workspace (Phase 4). The panel lists the persisted groups of
// one course with their member chips, an "Observe" deep link into the group's
// read-only chatroom room, and create / edit / rename / delete entries. All
// mutations are delegated to the receipt-and-readback handlers in
// `use-teaching-learning-groups.tsx`; this file only renders and validates the
// draft client-side against the same 2..12 member bounds the server enforces.

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
import {
  learningGroupMaxMembers,
  learningGroupMinMembers,
  type TeachingLearningGroupDraft,
  type TeachingLearningGroupItem,
  type TeachingLearningGroupPatch,
} from "./use-teaching-learning-groups";

export type ApprovedCourseMember = {
  studentId: string;
  studentDisplayName: string;
  classId: string;
};

type LearningGroupDialogState =
  | { mode: "create" }
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
}) {
  const t = copy[locale].teaching;
  const courseTitle = localizedText(course.title, locale);
  const [dialogState, setDialogState] = useState<LearningGroupDialogState>();
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const approvedMembers = useMemo(
    () => createApprovedCourseMembers(classes, membershipsByClass),
    [classes, membershipsByClass],
  );

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
          locale={locale}
          group={dialogState.mode === "edit" ? dialogState.group : undefined}
          onCancel={() => setDialogState(undefined)}
          onSubmit={async (draft) => {
            if (dialogState.mode === "edit") {
              await onUpdateGroup(dialogState.group.groupId, {
                groupName: draft.groupName,
                memberIds: draft.memberIds,
              });
            } else {
              await onCreateGroup(draft);
            }
            setDialogState(undefined);
          }}
        />
      ) : null}
    </div>
  );
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
  group,
  locale,
  // Seam for the `generate-student-group-suggestions` receipt action: a teacher-
  // reviewed suggestion can pre-fill the picker by passing the suggested student
  // ids here. Auto-assignment stays teacher-reviewed — the dialog still requires
  // an explicit submit. Not wired yet (the suggestion action lives on the
  // students operation page, outside this workspace's scope).
  suggestedMemberIds,
  onCancel,
  onSubmit,
}: {
  course: TeacherCourse;
  classes: TeacherClassItem[];
  approvedMembers: ApprovedCourseMember[];
  group?: TeachingLearningGroupItem;
  locale: Locale;
  suggestedMemberIds?: string[];
  onCancel: () => void;
  onSubmit: (draft: TeachingLearningGroupDraft) => Promise<void>;
}) {
  const t = copy[locale].teaching;
  const isEditing = Boolean(group);
  const [groupName, setGroupName] = useState(group?.groupName ?? "");
  const [classId, setClassId] = useState(group?.classId ?? "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    () => group?.members.map((member) => member.studentId) ?? suggestedMemberIds ?? [],
  );
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // A class-scoped group may only hold members of that class, mirroring the
  // server-side approved-membership lookup.
  const selectableMembers = classId
    ? approvedMembers.filter((member) => member.classId === classId)
    : approvedMembers;
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
            {selectableMembers.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {selectableMembers.map((member) => (
                  <label
                    key={member.studentId}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--foreground)]"
                  >
                    <input
                      type="checkbox"
                      value={member.studentId}
                      checked={selectedMemberIds.includes(member.studentId)}
                      className="size-4"
                      onChange={() => toggleMember(member.studentId)}
                    />
                    {member.studentDisplayName}
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--muted)]">{t.groupNoApprovedMembers}</p>
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
