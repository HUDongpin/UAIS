"use client";

// Invite-code workspace tools for the teacher workspace (Phase 3 decomposition of
// teaching-page.tsx), rebuilt honestly in plan E9.
//
// Three things were wrong here and are fixed together, because they were one
// problem seen from three sides:
//
//  - The "valid until 2026-12-17 / join limit 60" cards were module constants.
//    No record carried them and no route enforced them. They now read the
//    selected class's real `inviteExpiresAt` / `inviteMaxJoins` / `inviteDisabled`,
//    and say "no expiry" / "no limit" when a field is unset, which is a state the
//    join route treats as meaningful.
//  - The teacher had no way to SET any of those. The publish action now carries an
//    `invitePolicy` patch (E8's field on the operations route), so the card and
//    the form describe the same three fields.
//  - Both actions silently targeted `courseCards[0]` and that course's first
//    class. The course now comes from the workspace-wide selector and the class
//    from the picker below, and the actions stay disabled until both resolve -
//    because "generate an invite code" for the wrong class is not an error anyone
//    sees until a student joins the wrong room. A course with exactly one class
//    still resolves without a click; there is nothing to choose between.

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { InvitationQrCode } from "@/components/teaching/invitation-qr-code";
import {
  describeInviteAvailability,
  describeInviteExpiry,
  describeInviteJoinLimit,
  type InviteCodePolicyDraft,
} from "@/components/teaching/invite-code-policy";
import { localizedText } from "@/components/ui/localized-text";
import { copy } from "@/i18n/copy";
import type { Locale, LocalizedText } from "@/i18n/copy";
import type { TeacherClassItem } from "@/lib/teaching/course-readback";
import {
  INVITE_CODE_COPIED_MESSAGE,
  INVITE_LINK_COPIED_MESSAGE,
} from "./teaching-page-messages";

type InviteCodeWorkspaceToolsProps = {
  locale: Locale;
  inviteWorkspaceCode: string;
  inviteWorkspaceJoinUrl: string;
  inviteWorkspaceStatus: LocalizedText;
  // Classes of the workspace-selected course; empty until a course is chosen.
  inviteCourseClasses: TeacherClassItem[];
  selectedInviteCourseId?: string;
  selectedInviteClass?: TeacherClassItem;
  selectedInviteClassId?: string;
  invitePolicyDraft: InviteCodePolicyDraft;
  invitePolicyDraftError?: string;
  onSelectInviteClass: (classId: string) => void;
  onUpdateInvitePolicyDraft: (patch: Partial<InviteCodePolicyDraft>) => void;
  copyInviteWorkspaceValue: (value: string, successMessage: LocalizedText) => void;
  runInviteWorkspaceAction: (actionSlot: "primary" | "secondary") => void;
};

export function InviteCodeWorkspaceTools({
  locale,
  inviteWorkspaceCode,
  inviteWorkspaceJoinUrl,
  inviteWorkspaceStatus,
  inviteCourseClasses,
  selectedInviteCourseId,
  selectedInviteClass,
  selectedInviteClassId,
  invitePolicyDraft,
  invitePolicyDraftError,
  onSelectInviteClass,
  onUpdateInvitePolicyDraft,
  copyInviteWorkspaceValue,
  runInviteWorkspaceAction,
}: InviteCodeWorkspaceToolsProps) {
  const t = copy[locale].teaching;
  const selectedClass = selectedInviteClass;
  // Both halves are required: a class is what an invite code belongs to, and the
  // course is what proves ownership of it.
  const isTargetChosen = Boolean(selectedInviteCourseId && selectedInviteClassId);
  const isActionDisabled = !isTargetChosen || Boolean(invitePolicyDraftError);
  const metadata = [
    {
      label: t.inviteValidityLabel,
      value: describeInviteExpiry(selectedClass, locale),
      note:
        locale === "zh-CN"
          ? "到期后加入链接将被服务端拒绝"
          : "After this the join route refuses the code",
    },
    {
      label: t.inviteJoinLimitLabel,
      value: describeInviteJoinLimit(selectedClass, locale),
      note:
        locale === "zh-CN"
          ? "达到上限后需要新的邀请码"
          : "Once reached, a new invite code is needed",
    },
    {
      label: t.inviteAvailabilityLabel,
      value: describeInviteAvailability(selectedClass, locale),
      note: selectedClass
        ? locale === "zh-CN"
          ? `班级：${selectedClass.name}`
          : `Class: ${selectedClass.name}`
        : t.inviteTargetPending,
    },
  ];

  return (
    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
        <div data-uais-invite-target-selector className="max-w-sm">
          <div className="min-w-0">
            <label
              htmlFor="invite-workspace-class"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              {t.inviteClassSelectLabel}
            </label>
            <select
              id="invite-workspace-class"
              value={selectedInviteClassId ?? ""}
              disabled={!selectedInviteCourseId}
              className="mt-2 h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={(event) => onSelectInviteClass(event.target.value)}
            >
              <option value="">{t.inviteClassPlaceholder}</option>
              {inviteCourseClasses.map((classItem) => (
                <option key={classItem.id} value={classItem.id}>
                  {classItem.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isTargetChosen ? null : (
          <p className="mt-3 text-sm font-medium text-[var(--muted)]">
            {t.inviteTargetRequired}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <QrCode size={24} weight="duotone" className="text-[var(--accent)]" />
              <p className="text-sm font-semibold text-[var(--muted)]">
                {locale === "zh-CN" ? "当前班级邀请码" : "Current class invite code"}
              </p>
            </div>
            <p className="mt-3 text-4xl font-semibold tracking-normal text-[var(--foreground)]">
              {inviteWorkspaceCode}
            </p>
            <p className="mt-2 break-all text-sm leading-6 text-[var(--muted)]">
              {inviteWorkspaceJoinUrl}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isActionDisabled}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void runInviteWorkspaceAction("primary")}
            >
              <QrCode size={17} weight="bold" />
              {locale === "zh-CN" ? "生成新邀请码" : "Generate New Invite Code"}
            </button>
            <button
              type="button"
              disabled={isActionDisabled}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void runInviteWorkspaceAction("secondary")}
            >
              <ClipboardText size={17} weight="duotone" />
              {locale === "zh-CN" ? "确认发布邀请码" : "Publish Invite Code"}
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              onClick={() =>
                void copyInviteWorkspaceValue(inviteWorkspaceCode, INVITE_CODE_COPIED_MESSAGE)
              }
            >
              <ClipboardText size={17} weight="duotone" />
              {locale === "zh-CN" ? "复制邀请码" : "Copy Invite Code"}
            </button>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              onClick={() =>
                void copyInviteWorkspaceValue(inviteWorkspaceJoinUrl, INVITE_LINK_COPIED_MESSAGE)
              }
            >
              <ArrowRight size={17} weight="bold" />
              {locale === "zh-CN" ? "复制加入链接" : "Copy Join Link"}
            </button>
          </div>
        </div>

        <p
          aria-live="polite"
          className="mt-4 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--accent)]"
        >
          {localizedText(inviteWorkspaceStatus, locale)}
        </p>

        {/* Publishing is the action that decides what a code may do, so the policy
            form sits with the publish button rather than in a settings page the
            teacher would have to remember to visit. */}
        <div
          data-uais-invite-policy-form
          className="mt-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 md:grid-cols-3"
        >
          <div className="min-w-0">
            <label
              htmlFor="invite-policy-expires-at"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              {t.inviteExpiryFieldLabel}
            </label>
            <input
              id="invite-policy-expires-at"
              type="datetime-local"
              value={invitePolicyDraft.expiresAtLocal}
              disabled={!isTargetChosen}
              className="mt-2 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={(event) =>
                onUpdateInvitePolicyDraft({ expiresAtLocal: event.target.value })
              }
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="invite-policy-max-joins"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              {t.inviteMaxJoinsFieldLabel}
            </label>
            <input
              id="invite-policy-max-joins"
              type="number"
              min={1}
              inputMode="numeric"
              value={invitePolicyDraft.maxJoins}
              disabled={!isTargetChosen}
              className="mt-2 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
              onChange={(event) => onUpdateInvitePolicyDraft({ maxJoins: event.target.value })}
            />
          </div>
          <label
            htmlFor="invite-policy-disabled"
            className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-[var(--foreground)]"
          >
            <input
              id="invite-policy-disabled"
              type="checkbox"
              checked={invitePolicyDraft.disabled}
              disabled={!isTargetChosen}
              className="size-4"
              onChange={(event) => onUpdateInvitePolicyDraft({ disabled: event.target.checked })}
            />
            {t.inviteDisabledFieldLabel}
          </label>
          {invitePolicyDraftError ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 md:col-span-3 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
            >
              {invitePolicyDraftError}
            </p>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {metadata.map((item) => (
            <article
              key={item.label}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">{item.label}</p>
              <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">{item.value}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.note}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <InvitationQrCode
          invitationCode={inviteWorkspaceCode}
          joinUrl={inviteWorkspaceJoinUrl}
          locale={locale}
          variant="inline"
        />
        <p className="mt-3 text-sm leading-6 text-[#5f6675]">{t.inviteScanHint}</p>
      </div>
    </div>
  );
}
