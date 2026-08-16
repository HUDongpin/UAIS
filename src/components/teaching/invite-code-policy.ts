// Honest, bilingual rendering of a class invite code's real policy (plan E9).
//
// The workspace used to print a hardcoded "valid until 2026-12-17" and a "join
// limit 60" that no record carried and no route enforced. Every value below is
// read from the class record the teacher course list returned, and an unset
// field says "no expiry" / "no limit" rather than inventing one — the join route
// refuses on exactly these three fields, so a teacher reading this card is
// reading the rule that will actually be applied.

import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import type { TeacherClassItem } from "@/lib/teaching/course-readback";

export type InviteCodePolicyDraft = {
  // `<input type="datetime-local">` value, i.e. local wall-clock without a zone.
  expiresAtLocal: string;
  // Free text so an empty box stays distinguishable from a typed 0, which the
  // store rejects on purpose.
  maxJoins: string;
  disabled: boolean;
};

export type InviteCodePolicyPatch = {
  expiresAt?: string | null;
  maxJoins?: number | null;
  disabled?: boolean;
};

export const emptyInviteCodePolicyDraft: InviteCodePolicyDraft = {
  expiresAtLocal: "",
  maxJoins: "",
  disabled: false,
};

export function createInviteCodePolicyDraft(
  classItem: TeacherClassItem | undefined,
): InviteCodePolicyDraft {
  if (!classItem) {
    return emptyInviteCodePolicyDraft;
  }
  return {
    expiresAtLocal: toInviteExpiryInputValue(classItem.inviteExpiresAt),
    maxJoins: classItem.inviteMaxJoins ? String(classItem.inviteMaxJoins) : "",
    disabled: classItem.inviteDisabled === true,
  };
}

// An omitted key means "leave as it is" and `null` clears one back to open, which
// is the contract `readInviteCodePolicy` on the operations route parses. Every
// field is always sent from the workspace because the form always shows all
// three: a cleared box is a deliberate "no expiry", not an absent opinion.
export function createInviteCodePolicyPatch(
  draft: InviteCodePolicyDraft,
): InviteCodePolicyPatch {
  const trimmedMaxJoins = draft.maxJoins.trim();
  const parsedMaxJoins = trimmedMaxJoins ? Number(trimmedMaxJoins) : undefined;
  return {
    expiresAt: fromInviteExpiryInputValue(draft.expiresAtLocal),
    maxJoins:
      parsedMaxJoins !== undefined && Number.isSafeInteger(parsedMaxJoins) && parsedMaxJoins > 0
        ? parsedMaxJoins
        : null,
    disabled: draft.disabled,
  };
}

// Rejected before the request rather than after: the store answers 400 for a
// non-integer or a zero limit, and a teacher typing "0" deserves the rule in
// front of them instead of a round trip.
export function readInviteCodePolicyDraftError(
  draft: InviteCodePolicyDraft,
  locale: Locale,
): string | undefined {
  const trimmedMaxJoins = draft.maxJoins.trim();
  if (trimmedMaxJoins) {
    const parsedMaxJoins = Number(trimmedMaxJoins);
    if (!Number.isSafeInteger(parsedMaxJoins) || parsedMaxJoins < 1) {
      return locale === "zh-CN"
        ? "加入上限需要是大于 0 的整数；如果不限人数，请留空。"
        : "The join limit must be a whole number above 0. Leave it blank for no limit.";
    }
  }
  if (draft.expiresAtLocal && Number.isNaN(Date.parse(draft.expiresAtLocal))) {
    return locale === "zh-CN"
      ? "有效期时间无法识别，请重新选择。"
      : "The expiry time could not be read. Please pick it again.";
  }
  return undefined;
}

export function describeInviteExpiry(
  classItem: TeacherClassItem | undefined,
  locale: Locale,
  now: Date = new Date(),
) {
  const expiresAt = classItem?.inviteExpiresAt;
  if (!expiresAt) {
    return copy[locale].teaching.inviteNoExpiry;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return copy[locale].teaching.inviteNoExpiry;
  }
  const formatted = formatInviteTimestamp(expiresAtMs, locale);
  if (expiresAtMs <= now.getTime()) {
    return locale === "zh-CN" ? `已于 ${formatted} 过期` : `Expired ${formatted}`;
  }
  return formatted;
}

export function describeInviteJoinLimit(
  classItem: TeacherClassItem | undefined,
  locale: Locale,
) {
  const maxJoins = classItem?.inviteMaxJoins;
  if (!maxJoins) {
    return copy[locale].teaching.inviteNoJoinLimit;
  }
  return locale === "zh-CN" ? `${maxJoins} 人` : `${maxJoins} students`;
}

export function describeInviteAvailability(
  classItem: TeacherClassItem | undefined,
  locale: Locale,
  now: Date = new Date(),
) {
  if (classItem?.inviteDisabled) {
    return locale === "zh-CN" ? "已停用" : "Disabled";
  }
  const expiresAtMs = classItem?.inviteExpiresAt
    ? Date.parse(classItem.inviteExpiresAt)
    : Number.NaN;
  if (!Number.isNaN(expiresAtMs) && expiresAtMs <= now.getTime()) {
    return locale === "zh-CN" ? "已过期" : "Expired";
  }
  return locale === "zh-CN" ? "可加入" : "Open";
}

// `datetime-local` speaks local wall-clock with no zone, so the stored instant is
// shifted into the browser's own offset on the way in and back out again. Doing
// it with the raw ISO string would silently move the deadline by the offset.
export function toInviteExpiryInputValue(expiresAt: string | undefined) {
  if (!expiresAt) {
    return "";
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return "";
  }
  const local = new Date(expiresAtMs - new Date(expiresAtMs).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromInviteExpiryInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function formatInviteTimestamp(timestampMs: number, locale: Locale) {
  const stamp = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
  const time = `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
  return locale === "zh-CN" ? `${date} ${time}` : `${date} ${time}`;
}
