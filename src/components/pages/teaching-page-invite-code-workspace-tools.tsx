"use client";

// Invite-code workspace tools for the teacher workspace (Phase 3 decomposition of
// teaching-page.tsx). Extracted verbatim from renderInviteCodeWorkspaceTools; the
// closed-over invite state/handlers/locale are same-named props. The invite validity
// window and join limit (used only here) moved in as module constants.



import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { QrCode } from "@phosphor-icons/react/dist/ssr/QrCode";
import { localizedText } from "@/components/ui/localized-text";
import type { Locale, LocalizedText } from "@/i18n/copy";
import { InlineInvitationQrPattern } from "./teaching-page-dialogs";
import {
  INVITE_CODE_COPIED_MESSAGE,
  INVITE_LINK_COPIED_MESSAGE,
} from "./teaching-page-messages";

const INVITE_VALID_UNTIL = "2026-12-17";
const INVITE_JOIN_LIMIT = 60;

type InviteCodeWorkspaceToolsProps = {
  locale: Locale;
  inviteWorkspaceCode: string;
  inviteWorkspaceJoinUrl: string;
  inviteWorkspaceStatus: LocalizedText;
  copyInviteWorkspaceValue: (value: string, successMessage: LocalizedText) => void;
  runInviteWorkspaceAction: (actionSlot: "primary" | "secondary") => void;
};

export function InviteCodeWorkspaceTools({
  locale,
  inviteWorkspaceCode,
  inviteWorkspaceJoinUrl,
  inviteWorkspaceStatus,
  copyInviteWorkspaceValue,
  runInviteWorkspaceAction,
}: InviteCodeWorkspaceToolsProps) {
    const metadata = [
      {
        label: locale === "zh-CN" ? "有效期" : "Valid Until",
        value: INVITE_VALID_UNTIL,
        note: locale === "zh-CN" ? "到期后自动停止加入" : "Joining stops automatically after expiry",
      },
      {
        label: locale === "zh-CN" ? "班级范围" : "Class Scope",
        value: locale === "zh-CN" ? "班级" : "Class",
        note: locale === "zh-CN" ? "仅开放给当前教学班" : "Limited to the selected teaching class",
      },
      {
        label: locale === "zh-CN" ? "加入上限" : "Join Limit",
        value: locale === "zh-CN" ? `${INVITE_JOIN_LIMIT} 人` : `${INVITE_JOIN_LIMIT} students`,
        note: locale === "zh-CN" ? "超过上限需教师确认" : "Teacher confirmation required beyond the limit",
      },
    ];

    return (
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
                onClick={() => void runInviteWorkspaceAction("primary")}
              >
                <QrCode size={17} weight="bold" />
                {locale === "zh-CN" ? "生成新邀请码" : "Generate New Invite Code"}
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {metadata.map((item) => (
              <article
                key={item.label}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                  {item.value}
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{item.note}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
          <InlineInvitationQrPattern
            invitationCode={inviteWorkspaceCode}
            seed={`${inviteWorkspaceCode}-${inviteWorkspaceJoinUrl}`}
          />
        </div>
      </div>
    );
  }
