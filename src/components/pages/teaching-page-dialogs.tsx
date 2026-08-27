"use client";

// Course/class management and creation dialogs for the teacher workspace
// (Phase 3 decomposition of teaching-page.tsx). The main page renders
// CourseClassManager, NewClassDialog, ClassInvitationDialog and NewCourseDialog;
// the remaining components/helpers here are private to this file.
//
// Plan E9: the roster itself moved to `ClassMembershipRoster`, and the QR is now
// a real scannable code (`InvitationQrCode`) rather than a seeded hash pattern.



import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { FileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { MagicWand } from "@phosphor-icons/react/dist/ssr/MagicWand";
import { Package } from "@phosphor-icons/react/dist/ssr/Package";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { ClassMembershipRoster } from "@/components/teaching/class-membership-roster";
import { InvitationQrCode } from "@/components/teaching/invitation-qr-code";
import {
  describeInviteAvailability,
  describeInviteExpiry,
  describeInviteJoinLimit,
} from "@/components/teaching/invite-code-policy";
import { localizedText } from "@/components/ui/localized-text";
import type { TeacherCourse } from "@/data/uais";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import {
  createDefaultNewCourseDraft,
  normalizeTeachingActorId,
} from "@/lib/teaching/course-readback";
import type {
  NewCourseDraft,
  TeacherClassItem,
  TeacherClassMembershipItem,
} from "@/lib/teaching/course-readback";
import { createProvisionalTeachingCourseId } from "@/lib/teaching-course-id";
import {
  createCourseCoverBindingPartialFailureMessage,
  createCourseCoverGenerationFailureMessage,
  createInviteJoinUrl,
  createTeachingClassActionHref,
  isRecoverableCourseCoverBindingFailure,
  verifyCourseCoverAssetPersistence,
} from "./teaching-page-helpers";
import {
  INVITE_CODE_COPIED_MESSAGE,
  INVITE_COPY_FAILED_MESSAGE,
  TEACHING_COURSE_COVER_TEACHER_READBACK_REQUIRED_MESSAGE,
  TEACHING_OPERATION_SAVE_FAILED_MESSAGE,
} from "./teaching-page-messages";
import type {
  CourseCoverGenerationResponse,
  GeneratedCourseCover,
} from "./teaching-page-types";

const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function useDialogFocusManagement({
  dialogRef,
  onClose,
  closeDisabled = false,
  initialFocusSelector,
}: {
  dialogRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  closeDisabled?: boolean;
  initialFocusSelector?: string;
}) {
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const focusInitialControl = window.setTimeout(() => {
      const dialog = dialogRef.current;
      const preferred = initialFocusSelector
        ? dialog?.querySelector<HTMLElement>(initialFocusSelector)
        : undefined;
      const firstFocusable = dialog?.querySelector<HTMLElement>(
        dialogFocusableSelector,
      );
      (preferred ?? firstFocusable ?? dialog)?.focus();
    }, 0);

    function handleDialogKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      if (event.key === "Escape") {
        if (!closeDisabledRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(dialogFocusableSelector),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.clearTimeout(focusInitialControl);
      window.removeEventListener("keydown", handleDialogKeyDown);
      previouslyFocused?.focus();
    };
  }, [dialogRef, initialFocusSelector]);
}

export function CourseClassManager({
  course,
  classes,
  membershipsByClass,
  membershipApprovalStatuses,
  membershipLifecycleStatuses,
  classRosterStatuses,
  pendingMembershipIds,
  pendingBulkApprovalClassIds,
  locale,
  onApproveMembership,
  onApproveAllPendingMemberships,
  onRejectMembership,
  onRemoveMembership,
  onNewClass,
  onOpenInvitation,
}: {
  course: TeacherCourse;
  classes: TeacherClassItem[];
  membershipsByClass: Record<string, TeacherClassMembershipItem[]>;
  membershipApprovalStatuses: Record<string, string>;
  membershipLifecycleStatuses: Record<string, string>;
  classRosterStatuses: Record<string, string>;
  pendingMembershipIds: string[];
  pendingBulkApprovalClassIds: string[];
  locale: Locale;
  onApproveMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  onApproveAllPendingMemberships: (
    classItem: TeacherClassItem,
    pendingMemberships: TeacherClassMembershipItem[],
  ) => void;
  onRejectMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  onRemoveMembership: (
    classItem: TeacherClassItem,
    membership: TeacherClassMembershipItem,
  ) => void;
  onNewClass: () => void;
  onOpenInvitation: (classItem: TeacherClassItem) => void;
}) {
  const courseTitle = localizedText(course.title, locale);

  return (
    <div className="mt-5 border-t border-[var(--border)] pt-4">
      <button
        type="button"
        aria-label={
          locale === "zh-CN" ? `为${courseTitle}新建班级` : `New class for ${courseTitle}`
        }
        className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#1557c0] to-[#4338ca] px-5 text-base font-semibold text-white shadow-[0_12px_28px_rgba(83,115,255,0.24)] outline-none transition hover:shadow-[0_16px_34px_rgba(83,115,255,0.32)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1557c0] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
        onClick={onNewClass}
      >
        <Plus size={21} weight="bold" />
        {locale === "zh-CN" ? "新建班级" : "New class"}
      </button>

      {classes.length > 0 ? (
        <div className="mt-4 space-y-3">
          {classes.map((classItem) => {
            return (
              <div key={classItem.id} className="space-y-2">
                <div className="flex min-h-[82px] w-full flex-col gap-4 rounded-xl border border-[#e6eaf2] bg-white px-4 py-3 text-left text-[#1d2433] shadow-[0_12px_28px_rgba(46,58,91,0.06)] sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-[#aab2c4]" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-base font-semibold text-[#252a3a]">
                        <span className="truncate">{classItem.name}</span>
                        <QrCode size={18} weight="duotone" className="shrink-0 text-[#c4cad8]" />
                      </span>
                      <span className="mt-2 flex flex-wrap gap-x-7 gap-y-1 text-sm font-medium text-[var(--muted)]">
                        <span>
                          {locale === "zh-CN" ? "学生：" : "Students:"}
                          {classItem.students}
                        </span>
                        <span>{classItem.semester}</span>
                      </span>
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-4 sm:justify-end">
                    <Link
                      href={createTeachingClassActionHref("students", classItem, "enter-class")}
                      aria-label={
                        locale === "zh-CN"
                          ? `进入${classItem.name}`
                          : `Enter ${classItem.name}`
                      }
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#7eb1ff] px-4 text-sm font-medium text-[#1557c0] outline-none transition hover:bg-[#f4f8ff] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1557c0]"
                    >
                      <UsersThree size={16} weight="bold" />
                      {locale === "zh-CN" ? "进入班级" : "Take class"}
                    </Link>
                    <Link
                      href={createTeachingClassActionHref(
                        "quiz-board",
                        classItem,
                        "activity-list",
                      )}
                      aria-label={
                        locale === "zh-CN"
                          ? `查看${classItem.name}活动列表`
                          : `View activity list for ${classItem.name}`
                      }
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gradient-to-r from-[#1557c0] to-[#4338ca] px-4 text-sm font-medium text-white shadow-[0_8px_18px_rgba(83,115,255,0.24)] outline-none transition hover:shadow-[0_10px_22px_rgba(83,115,255,0.3)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#1557c0]"
                    >
                      <ClipboardText size={16} weight="bold" />
                      {locale === "zh-CN" ? "活动列表" : "Activity List"}
                    </Link>
                    <button
                      type="button"
                      aria-label={
                        locale === "zh-CN"
                          ? `打开${classItem.name}的邀请码`
                          : `Open invitation QR for ${classItem.name}`
                      }
                      title={
                        locale === "zh-CN"
                          ? `打开${classItem.name}的邀请码`
                          : `Open invitation QR for ${classItem.name}`
                      }
                      className="grid size-12 shrink-0 place-items-center rounded-full border border-[#e1e7f2] text-[#7b8499] outline-none transition hover:border-[#7eb1ff] hover:bg-[#f4f8ff] hover:text-[#2f7cff] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
                      onClick={() => onOpenInvitation(classItem)}
                    >
                      <QrCode size={18} weight="duotone" />
                    </button>
                  </div>
                </div>

                <ClassMembershipRoster
                  classItem={classItem}
                  memberships={membershipsByClass[classItem.id] ?? []}
                  membershipApprovalStatuses={membershipApprovalStatuses}
                  membershipLifecycleStatuses={membershipLifecycleStatuses}
                  classRosterStatus={classRosterStatuses[classItem.id]}
                  pendingMembershipIds={pendingMembershipIds}
                  isBulkApprovalPending={pendingBulkApprovalClassIds.includes(classItem.id)}
                  locale={locale}
                  onApproveMembership={onApproveMembership}
                  onApproveAllPendingMemberships={onApproveAllPendingMemberships}
                  onRejectMembership={onRejectMembership}
                  onRemoveMembership={onRemoveMembership}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {locale === "zh-CN"
            ? "还没有班级，先为这门课程新建一个班级。"
            : "No classes yet. Create a class for this course first."}
        </p>
      )}
    </div>
  );
}

export function NewClassDialog({
  course,
  locale,
  onCancel,
  onCreate,
}: {
  course: TeacherCourse;
  locale: Locale;
  onCancel: () => void;
  onCreate: (className: string) => Promise<void> | void;
}) {
  const [className, setClassName] = useState("");
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReady = className.trim().length > 0;
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocusManagement({
    dialogRef,
    onClose: onCancel,
    closeDisabled: isSubmitting,
    initialFocusSelector: "#new-class-name",
  });

  async function submitNewClass(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || isSubmitting) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);
    try {
      await onCreate(className);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-10 backdrop-blur-sm">
      <form
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="new-class-title"
        className="w-full max-w-3xl overflow-hidden rounded-[14px] border border-[#dfe4ee] bg-white text-[#111827] shadow-[0_28px_80px_rgba(36,53,90,0.22)]"
        onSubmit={submitNewClass}
      >
        <header className="flex min-h-20 items-center justify-between border-b border-[#edf0f5] px-7">
          <div>
            <h2 id="new-class-title" className="text-3xl font-semibold tracking-normal">
              {locale === "zh-CN" ? "新建班级" : "New class"}
            </h2>
            <p className="sr-only">{localizedText(course.title, locale)}</p>
          </div>
          <button
            type="button"
            aria-label={locale === "zh-CN" ? "关闭新建班级弹窗" : "Close new class dialog"}
            disabled={isSubmitting}
            className="inline-flex size-11 items-center justify-center rounded-full text-[#c4ccda] outline-none transition hover:bg-[#f4f7fb] hover:text-[#7c879a] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-55"
            onClick={onCancel}
          >
            <X size={32} weight="bold" />
          </button>
        </header>
        <div className="px-7 py-12">
          <label htmlFor="new-class-name" className="sr-only">
            {locale === "zh-CN" ? "班级名称" : "Class name"}
          </label>
          <input
            id="new-class-name"
            aria-label={locale === "zh-CN" ? "班级名称" : "Class name"}
            value={className}
            placeholder={locale === "zh-CN" ? "输入班级名称" : "Enter class name"}
            className="h-16 w-full rounded-lg border border-[#d8dde6] bg-white px-5 text-xl font-medium text-[#111827] outline-none transition placeholder:text-[#aab3c2] focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
            onChange={(event) => {
              setFormError(undefined);
              setClassName(event.target.value);
            }}
          />
          {formError ? (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
            >
              {formError}
            </p>
          ) : null}
        </div>
        <footer className="flex justify-end gap-6 px-7 pb-8">
          <button
            type="button"
            disabled={isSubmitting}
            className="inline-flex h-14 min-w-36 items-center justify-center rounded-full border border-[#7eb1ff] bg-white px-8 text-lg font-semibold text-[#1557c0] outline-none transition hover:bg-[#f4f8ff] focus-visible:ring-2 focus-visible:ring-[#1557c0] disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            {locale === "zh-CN" ? "取消" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={!isReady || isSubmitting}
            className="inline-flex h-14 min-w-36 items-center justify-center rounded-full bg-gradient-to-r from-[#1557c0] to-[#4338ca] px-8 text-lg font-semibold text-white shadow-[0_14px_28px_rgba(92,129,255,0.24)] outline-none transition focus-visible:ring-2 focus-visible:ring-[#1557c0] disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isSubmitting
              ? locale === "zh-CN"
                ? "保存中"
                : "Saving"
              : locale === "zh-CN"
                ? "完成"
                : "Done"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function ClassInvitationDialog({
  classItem,
  locale,
  onClose,
}: {
  classItem: TeacherClassItem;
  locale: Locale;
  onClose: () => void;
}) {
  const t = copy[locale].teaching;
  // The class record's own join path when it has one (a published code carries
  // it), otherwise the same path the store would have written.
  const joinUrl = classItem.joinUrl?.trim() || createInviteJoinUrl(classItem.invitationCode);
  // The clipboard glyph beside the code used to be bare decoration: the universal
  // "copy this" affordance, with nothing behind it, next to a code a teacher is
  // expected to hand out. The invite-code workspace already had working copy
  // buttons, which made this one read as broken rather than absent.
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocusManagement({ dialogRef, onClose });

  async function copyInvitationCode() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable.");
      }
      await navigator.clipboard.writeText(classItem.invitationCode);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-8 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={
          locale === "zh-CN"
            ? `${classItem.name}邀请码`
            : `${classItem.name} invitation QR`
        }
        className="relative w-full max-w-[760px] rounded-[10px] bg-white px-10 pb-9 pt-14 text-center text-[#151b2d] shadow-[0_28px_80px_rgba(36,53,90,0.22)]"
      >
        <button
          type="button"
          aria-label={locale === "zh-CN" ? "关闭班级邀请码" : "Close class invitation QR"}
          className="absolute right-6 top-5 inline-flex size-11 items-center justify-center rounded-full text-[#c4ccda] outline-none transition hover:bg-[#f4f7fb] hover:text-[#7c879a] focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
          onClick={onClose}
        >
          <X size={30} weight="bold" />
        </button>
        <div className="flex flex-wrap items-end justify-center gap-4">
          <p className="pb-2 text-2xl font-medium text-[#5f6675]">
            {locale === "zh-CN" ? "邀请码：" : "Invitation code:"}
          </p>
          <p className="text-6xl font-semibold leading-none text-[#6375ff]">
            {classItem.invitationCode}
          </p>
          <button
            type="button"
            data-uais-class-invitation-copy={classItem.invitationCode}
            aria-label={
              locale === "zh-CN"
                ? `复制邀请码 ${classItem.invitationCode}`
                : `Copy invite code ${classItem.invitationCode}`
            }
            className="mb-3 inline-flex size-11 items-center justify-center rounded-full text-[#9ab4d6] outline-none transition hover:bg-[#f4f7fb] hover:text-[#6375ff] focus-visible:ring-2 focus-visible:ring-[#2f7cff]"
            onClick={() => void copyInvitationCode()}
          >
            <ClipboardText size={28} weight="duotone" />
          </button>
        </div>
        {copyStatus === "idle" ? undefined : (
          <p
            role="status"
            data-uais-class-invitation-copy-status={copyStatus}
            className={`mt-3 text-base font-medium ${
              copyStatus === "copied" ? "text-[#3f9b6d]" : "text-[#c2544d]"
            }`}
          >
            {localizedText(
              copyStatus === "copied" ? INVITE_CODE_COPIED_MESSAGE : INVITE_COPY_FAILED_MESSAGE,
              locale,
            )}
          </p>
        )}
        {/* The three real ways in, in the order a student meets them. The line
            this replaced pointed at a code box on the homepage that does not
            exist; the box now does exist, on the course plaza page. */}
        <p className="mt-5 text-xl font-medium text-[#a1a6b4]">{t.inviteScanHint}</p>
        <div className="mt-8 rounded-lg border border-[#eceff4] bg-white p-7">
          <InvitationQrCode
            invitationCode={classItem.invitationCode}
            joinUrl={joinUrl}
            locale={locale}
          />
        </div>
        <dl
          data-uais-class-invitation-policy={classItem.invitationCode}
          className="mt-7 grid gap-3 text-left sm:grid-cols-3"
        >
          <InvitationPolicyEntry
            label={t.inviteValidityLabel}
            value={describeInviteExpiry(classItem, locale)}
          />
          <InvitationPolicyEntry
            label={t.inviteJoinLimitLabel}
            value={describeInviteJoinLimit(classItem, locale)}
          />
          <InvitationPolicyEntry
            label={t.inviteAvailabilityLabel}
            value={describeInviteAvailability(classItem, locale)}
          />
        </dl>
        <p className="mt-8 text-3xl font-medium text-[#141b2d]">{classItem.name}</p>
      </section>
    </div>
  );
}

function InvitationPolicyEntry({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#eceff4] bg-[#fafbfe] px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-[#252a3a]">{value}</dd>
    </div>
  );
}

export function NewCourseDialog({
  locale,
  teacherActorId,
  onCancel,
  onCreate,
}: {
  locale: Locale;
  teacherActorId?: string;
  onCancel: () => void;
  onCreate: (draft: NewCourseDraft) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<NewCourseDraft>(() =>
    createDefaultNewCourseDraft(locale),
  );
  const [draftCourseId, setDraftCourseId] = useState<string>();
  const [generatedCover, setGeneratedCover] = useState<GeneratedCourseCover>();
  const [coverError, setCoverError] = useState<string>();
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReady = draft.name.trim().length > 0;
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocusManagement({
    dialogRef,
    onClose: onCancel,
    closeDisabled: isSubmitting || isGeneratingCover,
    initialFocusSelector: "#new-course-name",
  });

  function updateDraft<Field extends keyof NewCourseDraft>(
    field: Field,
    value: NewCourseDraft[Field],
  ) {
    setFormError(undefined);
    if (draft[field] !== value) {
      setCoverError(undefined);
      setGeneratedCover(undefined);
      setDraftCourseId(undefined);
    }
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  async function submitNewCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isReady || isSubmitting || isGeneratingCover) {
      return;
    }

    setFormError(undefined);
    setIsSubmitting(true);
    try {
      await onCreate({
        ...draft,
        name: draft.name.trim(),
        ...(draftCourseId ? { courseId: draftCourseId } : {}),
        ...(generatedCover?.assetId ? { coverAssetId: generatedCover.assetId } : {}),
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : localizedText(TEACHING_OPERATION_SAVE_FAILED_MESSAGE, locale),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function generateCourseCover() {
    if (!isReady || isGeneratingCover) {
      return;
    }

    setCoverError(undefined);
    setGeneratedCover(undefined);
    const normalizedTeacherActorId = normalizeTeachingActorId(teacherActorId);
    if (!normalizedTeacherActorId) {
      setCoverError(
        localizedText(TEACHING_COURSE_COVER_TEACHER_READBACK_REQUIRED_MESSAGE, locale),
      );
      return;
    }

    setIsGeneratingCover(true);
    const nextDraftCourseId =
      draftCourseId ??
      createProvisionalTeachingCourseId({
        actorId: normalizedTeacherActorId,
        courseName: draft.name.trim(),
        now: new Date(),
      });

    try {
      const response = await fetch("/api/teaching/course-cover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: nextDraftCourseId,
          name: draft.name.trim(),
          instructor: draft.instructor,
          unit: draft.unit,
          department: draft.department,
          semester: draft.semester,
          description: draft.description,
        }),
      });
      const body = (await response.json()) as CourseCoverGenerationResponse;
      const recoverableBindingFailure =
        !response.ok && isRecoverableCourseCoverBindingFailure(body);

      if (!response.ok && !recoverableBindingFailure) {
        throw new Error(createCourseCoverGenerationFailureMessage(body, locale));
      }
      if (recoverableBindingFailure) {
        setDraftCourseId(undefined);
        setCoverError(createCourseCoverBindingPartialFailureMessage(body, locale));
        return;
      }
      if (!body.cover?.imageUrl) {
        throw new Error("Course cover generation returned no image.");
      }
      const coverAssetId = verifyCourseCoverAssetPersistence({
        payload: body,
        courseId: nextDraftCourseId,
        locale,
      });

      setDraftCourseId(nextDraftCourseId);
      setGeneratedCover({
        imageUrl: body.cover.imageUrl,
        assetId: coverAssetId,
        model: body.cover.model,
        requestId: body.cover.requestId,
      });
    } catch (error) {
      setDraftCourseId(undefined);
      setCoverError(error instanceof Error ? error.message : "Course cover generation failed.");
    } finally {
      setIsGeneratingCover(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-3 py-4 backdrop-blur-sm md:py-6">
      <form
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="new-course-title"
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-[22px] border border-[#d8e0ec] bg-white text-[#1b2433] shadow-[0_26px_80px_rgba(36,53,90,0.28)]"
        onSubmit={submitNewCourse}
      >
        <header className="flex min-h-18 items-center justify-between border-b border-[#edf0f5] px-6 md:px-9">
          <h2 id="new-course-title" className="text-2xl font-semibold tracking-normal text-[#1b2433]">
            {locale === "zh-CN" ? "新增课程" : "New course"}
          </h2>
          <button
            type="button"
            aria-label={locale === "zh-CN" ? "关闭新增课程弹窗" : "Close new course dialog"}
            disabled={isSubmitting}
            className="inline-flex size-11 items-center justify-center rounded-full text-[#c4ccda] outline-none transition hover:bg-[#f4f7fb] hover:text-[#7c879a] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:opacity-55"
            onClick={onCancel}
          >
            <X size={32} weight="bold" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-9 md:py-7">
          <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-x-7 gap-y-5 md:grid-cols-[110px_minmax(0,1fr)]">
              <label
                htmlFor="new-course-name"
                className="self-center text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "名称" : "Name"}
              </label>
              <input
                id="new-course-name"
                value={draft.name}
                placeholder={
                  locale === "zh-CN"
                    ? "输入课程名称后，可一键生成课程封面"
                    : "Enter the course name, then generate the course cover with one click"
                }
                className="h-[52px] rounded-lg border border-[#d8dde6] bg-white px-4 text-base font-medium text-[#111827] outline-none transition placeholder:text-[#aab3c2] focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
                onChange={(event) => updateDraft("name", event.target.value)}
              />

              <label
                htmlFor="new-course-instructor"
                className="self-center text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "讲师" : "Instructor"}
              </label>
              <input
                id="new-course-instructor"
                value={draft.instructor}
                className="h-[52px] rounded-lg border border-[#d8dde6] bg-white px-4 text-base font-medium text-[#111827] outline-none transition focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
                onChange={(event) => updateDraft("instructor", event.target.value)}
              />

              <label
                htmlFor="new-course-unit"
                className="self-start pt-7 text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "单位" : "Unit"}
              </label>
              <div
                data-uais-new-course-field-row="unit-description"
                className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1.2fr)]"
              >
                <div className="min-w-0 space-y-2">
                  <span className="block text-sm font-medium text-[#6b7280]">
                    {locale === "zh-CN" ? "学校" : "University"}
                  </span>
                  <NewCourseSelect
                    id="new-course-unit"
                    value={draft.unit}
                    options={
                      locale === "zh-CN"
                        ? ["广州大学（404）", "优爱思"]
                        : ["Guangzhou University (404)", "University AI System (UAIS)"]
                    }
                    onChange={(value) => updateDraft("unit", value)}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor="new-course-department"
                    className="block text-sm font-medium text-[#6b7280]"
                  >
                    {locale === "zh-CN" ? "院系" : "Department"}
                  </label>
                  <NewCourseSelect
                    id="new-course-department"
                    value={draft.department}
                    options={
                      locale === "zh-CN"
                        ? ["实验教学中心", "初等数学研究团队", "教师教育学院"]
                        : [
                            "Experimental Teaching Center",
                            "Elementary Mathematics Research Team",
                            "Faculty of Teacher Education",
                          ]
                    }
                    onChange={(value) => updateDraft("department", value)}
                  />
                </div>
                <div className="min-w-0 space-y-2">
                  <label
                    htmlFor="new-course-description"
                    className="block text-sm font-medium text-[#111827]"
                  >
                    {locale === "zh-CN" ? "描述" : "Description"}
                  </label>
                  <textarea
                    id="new-course-description"
                    value={draft.description}
                    rows={2}
                    placeholder={locale === "zh-CN" ? "简要课程重点" : "Brief course focus"}
                    className="min-h-[52px] w-full resize-none rounded-lg border border-[#d8dde6] bg-white px-4 py-3 text-base font-medium leading-6 text-[#111827] outline-none transition placeholder:text-[#aab3c2] focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
                    onChange={(event) => updateDraft("description", event.target.value)}
                  />
                </div>
              </div>

              <label
                htmlFor="new-course-semester"
                className="self-center text-base font-medium text-[#1f2937]"
              >
                {locale === "zh-CN" ? "学期" : "Semester"}
              </label>
              <NewCourseSelect
                id="new-course-semester"
                value={draft.semester}
                options={
                  locale === "zh-CN"
                    ? ["2025-2026第二学期", "2025-2026第一学期", "2026暑期"]
                    : ["Spring 2026", "Fall 2025", "Summer 2026"]
                }
                className="max-w-[430px]"
                onChange={(value) => updateDraft("semester", value)}
              />
            </div>

            <div
              data-uais-new-course-cover-panel="compact"
              className="rounded-2xl border border-[#edf0f5] bg-[#f8fbff] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-base font-medium text-[#1f2937]">
                  {locale === "zh-CN" ? "封面" : "Cover"}
                </p>
                {generatedCover?.model ? (
                  <p className="text-sm font-medium text-[#6777ff]">
                    {locale === "zh-CN" ? "封面已生成" : "Qwen cover generated"}
                  </p>
                ) : null}
              </div>
              <NewCourseCoverPreview
                courseName={draft.name}
                imageUrl={generatedCover?.imageUrl}
                locale={locale}
              />
              <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2">
                <button
                  type="button"
                  disabled={!isReady || isGeneratingCover}
                  className="inline-flex min-h-11 items-center gap-2 text-base font-semibold italic text-[#6777ff] outline-none transition hover:text-[#4058f2] focus-visible:ring-2 focus-visible:ring-[#2f7cff] disabled:cursor-not-allowed disabled:text-[#aab3c2]"
                  onClick={generateCourseCover}
                >
                  <MagicWand size={22} weight="fill" />
                  {isGeneratingCover
                    ? locale === "zh-CN"
                      ? "正在生成封面"
                      : "Generating cover"
                    : locale === "zh-CN"
                      ? "生成封面"
                      : "Generate Cover"}
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#596579]">
                {locale === "zh-CN"
                  ? "可使用 AI 生成 800×480 的课程封面。"
                  : "Generate an 800×480 course cover with AI."}
              </p>
              {coverError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                >
                  {coverError}
                </p>
              ) : null}
              {formError ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                >
                  {formError}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="flex flex-col gap-4 border-t border-[#edf0f5] bg-white px-7 py-5 shadow-[0_-18px_40px_rgba(30,45,75,0.06)] sm:flex-row sm:items-center sm:justify-between md:px-10">
          <div className="inline-flex items-center gap-3 text-lg font-semibold text-[#1557c0]">
            <Package size={25} weight="duotone" />
            {locale === "zh-CN" ? "正在使用演示教学包" : "Using Demonstration Teaching Package"}
          </div>
          <div className="flex flex-wrap justify-end gap-4">
            <button
              type="button"
              disabled={isSubmitting}
              className="inline-flex h-14 min-w-36 items-center justify-center rounded-full border border-[#7eb1ff] bg-white px-8 text-lg font-semibold text-[#1557c0] outline-none transition hover:bg-[#f4f8ff] focus-visible:ring-2 focus-visible:ring-[#1557c0] disabled:cursor-not-allowed"
              onClick={onCancel}
            >
              {locale === "zh-CN" ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={!isReady || isSubmitting || isGeneratingCover}
              className="inline-flex h-14 min-w-36 items-center justify-center rounded-full bg-gradient-to-r from-[#1557c0] to-[#4338ca] px-8 text-lg font-semibold text-white outline-none transition hover:shadow-[0_14px_28px_rgba(92,129,255,0.24)] focus-visible:ring-2 focus-visible:ring-[#1557c0] disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              {isSubmitting
                ? locale === "zh-CN"
                  ? "保存中"
                  : "Saving"
                : locale === "zh-CN"
                  ? "完成"
                  : "Done"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function NewCourseSelect({
  id,
  ariaLabel,
  value,
  options,
  className = "",
  onChange,
}: {
  id: string;
  ariaLabel?: string;
  value: string;
  options: string[];
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={["relative min-w-0", className].filter(Boolean).join(" ")}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        className="h-[52px] w-full min-w-0 appearance-none rounded-lg border border-[#d8dde6] bg-white px-4 pr-11 text-base font-medium text-[#111827] outline-none transition focus:border-[#2f7cff] focus:ring-4 focus:ring-[#2f7cff]/12"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <CaretDown
        size={20}
        weight="fill"
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#c8d1df]"
      />
    </div>
  );
}

function NewCourseCoverPreview({
  imageUrl,
  courseName,
  locale,
}: {
  imageUrl?: string;
  courseName: string;
  locale: Locale;
}) {
  const coverLabel =
    locale === "zh-CN"
      ? `为${courseName.trim() || "新课程"}生成的课程封面`
      : `Generated course cover for ${courseName.trim() || "new course"}`;

  if (imageUrl) {
    return (
      <div className="relative aspect-[5/3] w-full overflow-hidden rounded-lg bg-[#e8eef9] shadow-[0_16px_32px_rgba(39,78,160,0.14)]">
        <div
          role="img"
          aria-label={coverLabel}
          className="h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="relative aspect-[5/3] w-full overflow-hidden rounded-lg bg-[#356bd8] shadow-[0_16px_32px_rgba(39,78,160,0.14)]"
    >
      <div className="absolute -left-6 top-16 h-24 w-24 rotate-[-28deg] border-[14px] border-[#8ed9ff] border-t-transparent bg-transparent opacity-95" />
      <BookOpen
        size={142}
        weight="duotone"
        className="absolute right-2 top-5 rotate-[-18deg] text-[#cae8ff]"
      />
      <FileText
        size={78}
        weight="duotone"
        className="absolute right-24 top-12 rotate-[18deg] text-[#9ed5ff]"
      />
      <PencilSimple
        size={132}
        weight="fill"
        className="absolute left-28 top-10 rotate-[-20deg] text-[#ffcf46]"
      />
      <span className="absolute right-5 bottom-7 h-12 w-24 rotate-[18deg] rounded-full border-[7px] border-[#f2bf26]" />
      <span className="absolute right-16 bottom-5 h-12 w-24 rotate-[18deg] rounded-full border-[7px] border-[#f2bf26]" />
      <span className="absolute bottom-0 left-0 h-16 w-full bg-gradient-to-t from-[#285cc8]/70 to-transparent" />
    </div>
  );
}
