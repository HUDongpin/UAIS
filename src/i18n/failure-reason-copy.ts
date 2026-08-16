// Bilingual sentences for the structured `reasonCode` values the API routes
// return alongside their English `error` strings.
//
// Before this, a refusal reached the student as whatever English sentence the
// route happened to carry - interpolated straight into a Chinese frame, so a
// learner on the default locale read "加入申请未提交：UAIS student authentication
// is required." The English half of that sentence is written for an operator
// reading a trace, not for the person who just clicked Join.
//
// The routes already answer with a machine-readable `reasonCode` on the paths
// that matter, so the UI can say the same thing in the reader's own language.
// The raw server string is not thrown away - the surfaces keep it in a collapsed
// secondary position for whoever is debugging - but it is no longer the sentence
// a student is asked to act on.

import type { Locale, LocalizedText } from "@/i18n/copy";

// Every code below is emitted by a route or store in this repository. Adding a
// code here is safe without a UI change: an unmapped code simply falls through
// to the generic sentence, which is the same behaviour a missing code has.
export const failureReasonCopy: Record<string, LocalizedText> = {
  // --- Sign-in / app session (src/app/api/auth/app-session/route.ts) ---
  "login-credentials-missing": {
    "zh-CN": "请输入账号和密码。",
    "en-US": "Enter an account and password.",
  },
  "login-credentials-invalid": {
    "zh-CN": "账号或密码不匹配，请使用已授权的 UAIS 账号登录。",
    "en-US": "The account or password does not match an authorized UAIS account.",
  },
  "app-auth-provider-not-production-ready": {
    "zh-CN": "登录服务尚未完成配置，暂时无法登录。",
    "en-US": "The sign-in service is not fully configured yet, so sign-in is unavailable.",
  },
  "app-session-signing-secret-missing": {
    "zh-CN": "登录服务尚未完成配置，暂时无法登录。",
    "en-US": "The sign-in service is not fully configured yet, so sign-in is unavailable.",
  },
  "app-session-signing-secret-weak": {
    "zh-CN": "登录服务尚未完成配置，暂时无法登录。",
    "en-US": "The sign-in service is not fully configured yet, so sign-in is unavailable.",
  },

  // --- Invite-code join (src/app/api/teaching/invite-codes/[code]/join) ---
  "student-session-required": {
    "zh-CN": "需要登录学生账号。",
    "en-US": "Student sign-in is required.",
  },
  "student-role-required": {
    "zh-CN": "当前登录的是教师账号，请使用学生账号加入班级。",
    "en-US": "This is a teacher account. Sign in with a student account to join a class.",
  },
  "student-auth-provider-not-production-ready": {
    "zh-CN": "登录服务尚未完成配置，暂时无法提交加入申请。",
    "en-US": "The sign-in service is not fully configured yet, so the join request cannot be submitted.",
  },
  "class-invite-code-not-found": {
    "zh-CN": "邀请码不存在，请向教师确认后重试。",
    "en-US": "That invite code does not exist. Ask the teacher to confirm it.",
  },
  "student-course-membership-already-exists": {
    "zh-CN": "你已经在这门课程中，无需重复加入。",
    "en-US": "You are already in this course, so there is nothing to join.",
  },
  "invite-join-rate-limited": {
    "zh-CN": "加入申请提交过于频繁，请稍后再试。",
    "en-US": "Too many join requests. Please try again shortly.",
  },
  "invite-code-disabled": {
    "zh-CN": "该邀请码已被教师停用，请向教师索取新的邀请码。",
    "en-US": "The teacher has disabled this invite code. Ask them for a new one.",
  },
  "invite-code-expired": {
    "zh-CN": "该邀请码已过期，请向教师索取新的邀请码。",
    "en-US": "This invite code has expired. Ask the teacher for a new one.",
  },
  "invite-code-capacity-reached": {
    "zh-CN": "该邀请码的名额已满，请向教师确认。",
    "en-US": "This invite code has reached its join limit. Please check with the teacher.",
  },

  // --- Chatroom and sharing ---
  "chatroom-room-frozen": {
    "zh-CN": "本聊天室已被授课教师暂时冻结，暂时无法发送新消息。",
    "en-US": "The teacher has temporarily frozen this chatroom, so new messages cannot be sent.",
  },
  "share-membership-required": {
    "zh-CN": "你还不是这门课程的成员，无法分享这段协作记录。",
    "en-US": "You are not a member of this course, so this transcript cannot be shared.",
  },
  "teacher-group-share-member-only": {
    "zh-CN": "只有该小组的成员可以分享这个小组的记录。",
    "en-US": "Only members of this group can share the group's transcript.",
  },
  "share-not-found": {
    "zh-CN": "分享链接不存在或已失效。",
    "en-US": "That share link does not exist or is no longer valid.",
  },
  "share-revocation-denied": {
    "zh-CN": "你没有撤销这个分享链接的权限。",
    "en-US": "You do not have permission to revoke this share link.",
  },

  // --- Course/teaching write contention and ownership ---
  // A retried optimistic write that kept losing its snapshot. Nothing is wrong
  // with what the user asked for; it simply needs to be asked again.
  "snapshot-contention": {
    "zh-CN": "该课程正在被同时修改，本次操作未保存，请重试。",
    "en-US": "This course was being changed at the same time, so nothing was saved. Please retry.",
  },
  "teacher-course-ownership-required": {
    "zh-CN": "只有课程的授课教师可以执行这个操作。",
    "en-US": "Only the course's own teacher can perform this action.",
  },
} as const;

export type FailureReasonCode = keyof typeof failureReasonCopy;

// The reason code carried by a UAIS error body, wherever the route chose to put
// it. Routes that answer with an access decision nest it under `access`; routes
// that rethrow a store error put it at the top level. Callers should not have to
// know which shape they got.
export type FailureReasonResponseBody = {
  error?: unknown;
  reasonCode?: unknown;
  access?: { reasonCode?: unknown } | null;
};

export function readFailureReasonCode(
  body: FailureReasonResponseBody | null | undefined,
): string | undefined {
  const topLevel = body?.reasonCode;
  if (typeof topLevel === "string" && topLevel.length > 0) {
    return topLevel;
  }
  const nested = body?.access?.reasonCode;
  return typeof nested === "string" && nested.length > 0 ? nested : undefined;
}

export function resolveFailureReasonText(
  reasonCode: string | undefined,
  locale: Locale,
): string | undefined {
  if (!reasonCode) {
    return undefined;
  }
  return failureReasonCopy[reasonCode]?.[locale];
}

export type LocalizedFailure = {
  // The sentence the reader is asked to act on. Always in their own language.
  message: string;
  // The route's own English string, kept only when it could not be mapped. The
  // surfaces render it collapsed and secondary; it is evidence for whoever is
  // debugging, never the instruction.
  rawDetail?: string;
};

// One resolution rule shared by every failure surface: a mapped reason code wins,
// an unmapped one falls back to the caller's generic sentence and keeps the raw
// server string aside.
export function resolveLocalizedFailure(input: {
  body: FailureReasonResponseBody | null | undefined;
  locale: Locale;
  fallbackMessage: string;
}): LocalizedFailure {
  const reasonText = resolveFailureReasonText(readFailureReasonCode(input.body), input.locale);
  if (reasonText) {
    return { message: reasonText };
  }
  const rawError = typeof input.body?.error === "string" ? input.body.error.trim() : "";
  return {
    message: input.fallbackMessage,
    ...(rawError ? { rawDetail: rawError } : {}),
  };
}
