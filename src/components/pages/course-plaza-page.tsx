"use client";

import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { ChalkboardTeacher } from "@phosphor-icons/react/dist/ssr/ChalkboardTeacher";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { localizedText } from "@/components/ui/localized-text";
import { plazaCourses } from "@/data/uais";
import { copy } from "@/i18n/copy";
import { resolveLocalizedFailure } from "@/i18n/failure-reason-copy";
import {
  createLoginHandoffHref,
  isSafeLoginReturnPath,
} from "@/lib/auth/login-return-path";
import {
  createStudentClassMembershipItems,
  createStudentMembershipLearningHref,
  isClosedStudentMembership,
  type StudentClassMembershipItem,
  type StudentMembershipCourseResponse,
} from "./student-membership-helpers";

const courseVisualClass = {
  violet:
    "bg-[linear-gradient(135deg,var(--accent-soft),color-mix(in_srgb,var(--accent)_16%,var(--surface)))] text-[var(--accent)]",
  indigo:
    "bg-[linear-gradient(135deg,color-mix(in_srgb,#4452b8_16%,var(--surface)),var(--accent-soft))] text-[var(--accent-strong)]",
};

const courseDisplayOrder: Record<string, number> = {
  "math-pedagogy": 0,
  "research-methods": 1,
};

function createLearningHref(learningCourseId: string) {
  return `/learning?courseId=${encodeURIComponent(learningCourseId)}`;
}

// The invite code shape the join route accepts, shared by the `?invite=` param
// and the box a student types a code into.
const inviteCodePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

type InviteCodeEntryState =
  | { status: "absent" }
  | { status: "valid"; inviteCode: string }
  | { status: "invalid" };

// Pure function of the server-provided `invite` search param: the server render
// and the first client render must resolve to the same state, so this must not
// read `window.location`.
function resolveInviteCodeEntry(inviteParam: string | undefined): InviteCodeEntryState {
  if (inviteParam === undefined) {
    return { status: "absent" };
  }
  const trimmedInviteParam = inviteParam.trim();
  if (inviteCodePattern.test(trimmedInviteParam)) {
    return { status: "valid", inviteCode: trimmedInviteParam };
  }

  return { status: "invalid" };
}

export function createInviteJoinPath(inviteCode: string) {
  return `/courses?invite=${encodeURIComponent(inviteCode)}`;
}

// The sign-in handoff moved to `@/lib/auth/login-return-path` once the playback
// stage, the chatroom notices and the student dashboard needed the same guard;
// both names stay exported here so this page remains their documented home.
export { createLoginHandoffHref, isSafeLoginReturnPath };

// A refusal the student can read.
//
// This used to interpolate the route's raw English string straight into the
// Chinese frame - "加入申请未提交：UAIS student authentication is required." - so
// the actionable half of the sentence was in a language the reader had not
// chosen. The routes answer with a structured `reasonCode` on every refusal that
// has a student-facing explanation, so the mapping in `@/i18n/failure-reason-copy`
// supplies the sentence and the raw string is demoted to a collapsed detail that
// only appears when no code matched.
function createInviteJoinFailure(
  body: InviteJoinResponse | undefined,
  traceId: string | undefined,
  locale: "zh-CN" | "en-US",
): InviteJoinStatus {
  const failure = resolveLocalizedFailure({
    body,
    locale,
    // No usable code: say only what is certainly true, and never dress the
    // server's operator-facing English up as the student's next step.
    fallbackMessage:
      locale === "zh-CN"
        ? "加入申请未提交，请稍后重试。"
        : "Join request was not submitted. Please retry later.",
  });
  const baseMessage = failure.rawDetail
    ? failure.message
    : locale === "zh-CN"
      ? `加入申请未提交：${failure.message}`
      : `Join request was not submitted: ${failure.message}`;

  return {
    state: "failed",
    message: traceId
      ? locale === "zh-CN"
        ? `${baseMessage}追踪编号：${traceId}`
        : `${baseMessage} Trace ID: ${traceId}`
      : baseMessage,
    ...(failure.rawDetail ? { detail: failure.rawDetail } : {}),
  };
}

type InviteJoinResponse = {
  membership?: {
    membershipStatus?: string;
  };
  error?: string;
  // Store-level refusals (disabled/expired/at-capacity invite codes, snapshot
  // contention) put the code at the top level; access refusals nest it.
  reasonCode?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

type InviteJoinStatus = {
  state: "idle" | "pending" | "success" | "failed";
  message?: string;
  // The server's own English string, kept only when the reason code was unknown.
  // Rendered collapsed and secondary - evidence, not instruction.
  detail?: string;
};

// Collapsed by default and never part of the sentence the student is asked to
// act on. It exists so an unmapped refusal is still diagnosable from the browser.
function InviteJoinFailureDetail({
  detail,
  label,
}: {
  detail?: string;
  label: string;
}) {
  if (!detail) {
    return null;
  }

  return (
    <details className="mt-2 text-xs font-normal" data-uais-invite-join-failure-detail>
      <summary className="cursor-pointer font-medium">{label}</summary>
      <span className="mt-1 block break-words">{detail}</span>
    </details>
  );
}

// The join status belongs to one specific invite param. App Router client
// navigation swaps the prop without remounting this component, so the status is
// stored together with the invite param it was produced for and is only shown
// while that param is still the active one.
type InviteJoinStatusEntry = {
  inviteParam: string | undefined;
  status: InviteJoinStatus;
};

const idleInviteJoinStatus: InviteJoinStatus = { state: "idle" };

// Only one invite panel is ever mounted, so the status line can carry a stable
// id for the join button to point at with aria-describedby.
const inviteJoinStatusMessageId = "invite-join-status-message";

type CoursePlazaPageProps = {
  inviteParam?: string;
};

// Same gate the student dashboard uses: only the real plaza route asks the
// server who the visitor is, so rendering the component in isolation never
// fires a courses read.
function shouldLoadPlazaMemberships() {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return false;
  }
  return window.location.pathname === "/courses" || window.location.pathname === "/courses/";
}

export function CoursePlazaPage({ inviteParam }: CoursePlazaPageProps = {}) {
  const { locale } = useAppPreferences();
  const t = copy[locale];
  // Derived on every render instead of seeded once: client-side navigation
  // between /courses?invite=A, /courses?invite=B and /courses reuses this
  // component instance, so stored state would keep showing a stale invite.
  const inviteCodeEntry = resolveInviteCodeEntry(inviteParam);
  const inviteCode =
    inviteCodeEntry.status === "valid" ? inviteCodeEntry.inviteCode : undefined;
  const [inviteJoinStatusEntry, setInviteJoinStatusEntry] = useState<InviteJoinStatusEntry>({
    inviteParam,
    status: idleInviteJoinStatus,
  });
  // The displayed status is deliberately collapsed to idle for every param other
  // than the current one, so it describes the panel on screen and never the work
  // still running behind it. It must therefore not be used to gate submission.
  const inviteJoinStatus =
    inviteJoinStatusEntry.inviteParam === inviteParam
      ? inviteJoinStatusEntry.status
      : idleInviteJoinStatus;
  // Authoritative in-flight tracking, independent of the displayed status: one
  // join POST at a time across every invite param. Client navigation from an
  // in-flight invite to another one collapses the displayed status to idle, and
  // gating on that would re-enable the button and let a second join start while
  // the first is still open, which the server then rejects as a duplicate.
  const [isInviteJoinInFlight, setIsInviteJoinInFlight] = useState(false);
  const isInviteJoinInFlightRef = useRef(false);
  // Manual entry keeps its own status line: it answers the box, not the panel the
  // link opened, and the two can be on screen together.
  const [manualInviteCode, setManualInviteCode] = useState("");
  const [manualInviteJoinStatus, setManualInviteJoinStatus] =
    useState<InviteJoinStatus>(idleInviteJoinStatus);
  const [manualInviteJoinReturnPath, setManualInviteJoinReturnPath] = useState<string>();
  // Set only by a `student-session-required` refusal, which is the server saying
  // in so many words that signing in is the missing step.
  const [inviteJoinRequiresSignIn, setInviteJoinRequiresSignIn] = useState(false);
  // Kept in step with the rendered param so an awaited response can ask whether
  // the invite it belongs to is still the one the student is looking at.
  const currentInviteParamRef = useRef(inviteParam);
  useEffect(() => {
    currentInviteParamRef.current = inviteParam;
  }, [inviteParam]);
  // The button is disabled while any join POST is open, including one started
  // from a different invite param. The displayed status is param-scoped and
  // collapses to idle across that navigation, so the panel would otherwise show
  // an ordinary-looking join button that is disabled for no stated reason. This
  // fills that gap with a neutral explanation, and only that gap: a param whose
  // own status is pending, successful or failed still shows its own message.
  const isBlockedByOtherInviteJoin =
    isInviteJoinInFlight && inviteJoinStatus.state === "idle";
  const inviteJoinMessage = isBlockedByOtherInviteJoin
    ? locale === "zh-CN"
      ? "另一个加入申请仍在提交中，请稍候。"
      : "Another join request is still in progress. Please wait."
    : inviteJoinStatus.message;
  const displayedCourses = [...plazaCourses].sort(
    (firstCourse, secondCourse) =>
      courseDisplayOrder[firstCourse.id] - courseDisplayOrder[secondCourse.id],
  );
  // The plaza used to be nothing but the two template sample cards, so a student
  // who had already joined a real class through an invite code came back here and
  // found no trace of it. A signed-in visitor's own classes now come first, and
  // the samples are demoted to a labelled example row behind them.
  const [plazaMemberships, setPlazaMemberships] = useState<StudentClassMembershipItem[]>([]);
  const hasPlazaMemberships = plazaMemberships.length > 0;

  useEffect(() => {
    if (!shouldLoadPlazaMemberships()) {
      return;
    }

    let isCancelled = false;

    async function loadPlazaMemberships() {
      try {
        const response = await fetch("/api/teaching/courses", {
          method: "GET",
          headers: { accept: "application/json" },
        });
        // A signed-out visitor is refused here, and that is the plaza's normal
        // resting state: it keeps the samples and the join affordances rather
        // than claiming an empty course list.
        if (!response.ok) {
          return;
        }
        const body = (await response.json().catch(() => null)) as
          | StudentMembershipCourseResponse
          | null;
        if (isCancelled || !body) {
          return;
        }

        setPlazaMemberships(createStudentClassMembershipItems(body));
      } catch {
        // Unreachable server: the samples and the invite box still work.
      }
    }

    void loadPlazaMemberships();

    return () => {
      isCancelled = true;
    };
  }, []);

  // A response may only write the status of the invite param it was submitted
  // for, and only while that param is still the current one. A superseded
  // submission resets its own entry to idle instead of recording its outcome:
  // it is no longer an answer to anything on screen, and leaving its pending
  // status behind would freeze the panel on a later revisit to that invite.
  function commitInviteJoinStatus(
    submissionInviteParam: string | undefined,
    status: InviteJoinStatus,
  ) {
    const isSubmissionStillCurrent = currentInviteParamRef.current === submissionInviteParam;
    setInviteJoinStatusEntry((currentEntry) => {
      if (isSubmissionStillCurrent) {
        return { inviteParam: submissionInviteParam, status };
      }
      if (currentEntry.inviteParam !== submissionInviteParam) {
        return currentEntry;
      }

      return { inviteParam: submissionInviteParam, status: idleInviteJoinStatus };
    });
  }

  // One join request, whether the code arrived in the link or was typed into the
  // box below. Both callers own their own status line; this owns the request, the
  // sign-in signal, and the single-flight guard shared between them.
  async function requestInviteJoin(
    joinInviteCode: string,
  ): Promise<{ status: InviteJoinStatus; requiresSignIn: boolean }> {
    try {
      const response = await fetch(
        `/api/teaching/invite-codes/${encodeURIComponent(joinInviteCode)}/join`,
        {
          method: "POST",
          headers: { accept: "application/json" },
        },
      );
      const body = (await response.json().catch(() => undefined)) as InviteJoinResponse | undefined;
      const traceId = body?.traceId ?? response.headers.get("x-uais-trace-id") ?? undefined;
      if (!response.ok || !body?.membership) {
        return {
          status: createInviteJoinFailure(body, traceId, locale),
          // The one refusal a student can actually fix themselves, and the only
          // one worth putting a sign-in link next to.
          requiresSignIn: body?.access?.reasonCode === "student-session-required",
        };
      }

      const isPendingReview = body.membership.membershipStatus === "pending-teacher-review";
      const baseMessage =
        locale === "zh-CN"
          ? isPendingReview
            ? "加入申请已提交，等待教师审批。"
            : "加入申请已提交，已直接加入班级。"
          : isPendingReview
            ? "Join request submitted and waiting for teacher review."
            : "Join request submitted and the class membership is active.";
      return {
        status: {
          state: "success",
          message: traceId
            ? locale === "zh-CN"
              ? `${baseMessage}追踪编号：${traceId}`
              : `${baseMessage} Trace ID: ${traceId}`
            : baseMessage,
        },
        requiresSignIn: false,
      };
    } catch {
      return {
        status: {
          state: "failed",
          message:
            locale === "zh-CN"
              ? "加入申请未提交，请稍后重试。"
              : "Join request was not submitted. Please retry later.",
        },
        requiresSignIn: false,
      };
    }
  }

  async function submitInviteJoin() {
    if (!inviteCode || isInviteJoinInFlightRef.current) {
      return;
    }

    const submissionInviteParam = inviteParam;
    isInviteJoinInFlightRef.current = true;
    setIsInviteJoinInFlight(true);
    commitInviteJoinStatus(submissionInviteParam, {
      state: "pending",
      message:
        locale === "zh-CN"
          ? "正在提交加入申请，请稍候。"
          : "Submitting join request. Please wait.",
    });
    try {
      const result = await requestInviteJoin(inviteCode);
      setInviteJoinRequiresSignIn(result.requiresSignIn);
      commitInviteJoinStatus(submissionInviteParam, result.status);
    } finally {
      isInviteJoinInFlightRef.current = false;
      setIsInviteJoinInFlight(false);
    }
  }

  // The manual box. A student who was handed a code on a slide has no link to
  // click, and before this there was nowhere on the site to type one - while the
  // invitation dialog told them to do exactly that.
  async function submitManualInviteJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typedInviteCode = manualInviteCode.trim();
    if (isInviteJoinInFlightRef.current) {
      return;
    }
    if (!inviteCodePattern.test(typedInviteCode)) {
      setManualInviteJoinStatus({
        state: "failed",
        message:
          locale === "zh-CN"
            ? "邀请码格式无效，请检查后重试。"
            : "That invite code is not a valid code. Check it and try again.",
      });
      return;
    }

    isInviteJoinInFlightRef.current = true;
    setIsInviteJoinInFlight(true);
    setManualInviteJoinStatus({
      state: "pending",
      message:
        locale === "zh-CN"
          ? "正在提交加入申请，请稍候。"
          : "Submitting join request. Please wait.",
    });
    try {
      const result = await requestInviteJoin(typedInviteCode);
      setManualInviteJoinReturnPath(createInviteJoinPath(typedInviteCode));
      setInviteJoinRequiresSignIn(result.requiresSignIn);
      setManualInviteJoinStatus(result.status);
    } finally {
      isInviteJoinInFlightRef.current = false;
      setIsInviteJoinInFlight(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_var(--shadow)] md:grid-cols-[1.5fr_0.8fr] md:p-7">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
            {t.coursePlaza.title}
          </h1>
        </div>
        <aside className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent)] text-white">
              <Sparkle size={20} weight="duotone" />
            </span>
            <div>
              <p className="font-semibold text-[var(--foreground)]">{t.brand.name}</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            {t.brand.uaisMeaning}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {t.brand.topMeaning}
          </p>
        </aside>
      </section>

      {inviteCodeEntry.status === "invalid" ? (
        <section
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-medium text-rose-700 shadow-[0_18px_42px_var(--shadow)] dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
        >
          {locale === "zh-CN"
            ? "邀请码链接无效，请检查链接或向教师确认。"
            : "The invite-code link is invalid. Check the link or ask the teacher to confirm it."}
        </section>
      ) : null}

      {inviteCode ? (
        <section className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] p-5 shadow-[0_18px_42px_var(--shadow)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
                {locale === "zh-CN" ? "班级加入申请" : "Class Join Request"}
              </h2>
              <p className="mt-2 text-sm font-semibold text-[var(--accent)]">
                {locale === "zh-CN" ? `邀请码：${inviteCode}` : `Invite code: ${inviteCode}`}
              </p>
              {inviteJoinMessage ? (
                // A div rather than a p: the collapsed technical detail below is
                // a <details>, which a paragraph may not contain.
                <div
                  id={inviteJoinStatusMessageId}
                  role={inviteJoinStatus.state === "failed" ? "alert" : "status"}
                  className={[
                    "mt-3 rounded-xl border px-3 py-2 text-sm font-medium",
                    inviteJoinStatus.state === "failed"
                      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
                  ].join(" ")}
                >
                  {inviteJoinMessage}
                  {isBlockedByOtherInviteJoin ? null : (
                    <InviteJoinFailureDetail
                      detail={inviteJoinStatus.detail}
                      label={t.auth.technicalDetail}
                    />
                  )}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col items-start gap-2">
              <button
                type="button"
                disabled={isInviteJoinInFlight}
                aria-describedby={inviteJoinMessage ? inviteJoinStatusMessageId : undefined}
                className="inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-[0_14px_28px_var(--shadow-accent)] outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
                onClick={() => void submitInviteJoin()}
              >
                {inviteJoinStatus.state === "pending"
                  ? locale === "zh-CN"
                    ? "正在提交"
                    : "Submitting"
                  : locale === "zh-CN"
                    ? "申请加入班级"
                    : "Request to Join Class"}
              </button>
              {inviteJoinRequiresSignIn ? (
                <Link
                  href={createLoginHandoffHref(createInviteJoinPath(inviteCode))}
                  data-uais-invite-login-handoff={inviteCode}
                  className="inline-flex min-h-11 w-fit items-center justify-center rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-5 text-sm font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {locale === "zh-CN" ? "登录后继续加入" : "Sign in and continue"}
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* The manual code box. It is always available, because a code handed out
          on a slide arrives without a link, and it submits through exactly the
          same join route the link does. */}
      <section
        data-uais-manual-invite-entry
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]"
      >
        <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
          {locale === "zh-CN" ? "输入邀请码加入班级" : "Join a Class with an Invite Code"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {locale === "zh-CN"
            ? "扫描教师提供的二维码、打开加入链接，或在这里输入邀请码。"
            : "Scan the teacher's QR code, open the join link, or type the invite code here."}
        </p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={submitManualInviteJoin}>
          <div className="min-w-0">
            <label
              htmlFor="manual-invite-code"
              className="block text-sm font-semibold text-[var(--foreground)]"
            >
              {locale === "zh-CN" ? "邀请码" : "Invite code"}
            </label>
            <input
              id="manual-invite-code"
              value={manualInviteCode}
              aria-label={locale === "zh-CN" ? "邀请码" : "Invite code"}
              placeholder={locale === "zh-CN" ? "输入教师提供的邀请码" : "Enter the invite code"}
              className="mt-2 h-11 w-64 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 text-sm font-medium text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              onChange={(event) => setManualInviteCode(event.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={isInviteJoinInFlight}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-[0_14px_28px_var(--shadow-accent)] outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {/* Deliberately not the same label as the panel's button: with a
                link-borne invite on screen there would be two controls with one
                name, and neither the reader nor the screen reader could tell
                which code each one submits. */}
            {manualInviteJoinStatus.state === "pending"
              ? locale === "zh-CN"
                ? "正在提交"
                : "Submitting"
              : locale === "zh-CN"
                ? "使用邀请码加入"
                : "Join with This Code"}
          </button>
        </form>
        {manualInviteJoinStatus.message ? (
          <div
            role={manualInviteJoinStatus.state === "failed" ? "alert" : "status"}
            className={[
              "mt-3 rounded-xl border px-3 py-2 text-sm font-medium",
              manualInviteJoinStatus.state === "failed"
                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)]",
            ].join(" ")}
          >
            {manualInviteJoinStatus.message}
            <InviteJoinFailureDetail
              detail={manualInviteJoinStatus.detail}
              label={t.auth.technicalDetail}
            />
          </div>
        ) : null}
        {inviteJoinRequiresSignIn && manualInviteJoinReturnPath ? (
          <Link
            href={createLoginHandoffHref(manualInviteJoinReturnPath)}
            data-uais-manual-invite-login-handoff
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--accent-border)] bg-[var(--surface)] px-5 text-sm font-semibold text-[var(--accent)] outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {locale === "zh-CN" ? "登录后继续加入" : "Sign in and continue"}
          </Link>
        ) : null}
      </section>

      {hasPlazaMemberships ? (
        <section
          data-uais-plaza-my-courses="true"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]"
        >
          <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
            {t.coursePlaza.myCourses}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {t.coursePlaza.myCoursesSummary}
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {plazaMemberships.map((membership) => (
              <article
                key={membership.id}
                data-uais-plaza-membership={membership.id}
                className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--accent)]">
                    {membership.courseName}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                    {membership.className}
                  </h3>
                  {membership.semester ? (
                    <p className="mt-1 text-sm text-[var(--muted)]">{membership.semester}</p>
                  ) : null}
                  <span
                    data-uais-plaza-membership-status={membership.membershipStatus}
                    className={[
                      "mt-3 inline-flex h-8 items-center rounded-full px-3 text-sm font-semibold",
                      membership.membershipStatus === "approved"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                        : isClosedStudentMembership(membership)
                          ? "bg-[var(--surface-soft)] text-[var(--muted)]"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
                    ].join(" ")}
                  >
                    {membership.membershipStatus === "approved"
                      ? t.coursePlaza.membershipApproved
                      : membership.membershipStatus === "rejected"
                        ? t.coursePlaza.membershipRejected
                        : membership.membershipStatus === "removed"
                          ? t.coursePlaza.membershipRemoved
                          : t.coursePlaza.membershipPending}
                  </span>
                  {/* Declined and removed rows are reported precisely so a class
                      leaving the list has an explanation attached to it. Subtle,
                      and never accompanied by an entry link. */}
                  {isClosedStudentMembership(membership) ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      {t.coursePlaza.membershipClosedNote}
                    </p>
                  ) : null}
                </div>
                {/* Only an approved membership has a workspace to enter. A
                    pending, declined or removed one links nowhere rather than
                    to a 403. */}
                {membership.membershipStatus === "approved" ? (
                  <Link
                    href={createStudentMembershipLearningHref(membership)}
                    className="mt-4 inline-flex h-11 w-fit items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-[0_14px_28px_var(--shadow-accent)] outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-elevated)]"
                  >
                    {t.common.enterLearning}
                    <ArrowRight size={17} weight="bold" />
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Named as samples for EVERY visitor, not only once a real class is on
          the page above. A signed-out visitor is exactly the person with no
          other cards to compare these against, so leaving them unlabelled is
          where "示例课程" is needed most. */}
      <div data-uais-plaza-sample-heading="true">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--foreground)]">
          {t.coursePlaza.sampleCourses}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {t.coursePlaza.sampleCoursesSummary}
        </p>
      </div>

      <section
        data-uais-plaza-sample-courses={hasPlazaMemberships ? "demoted" : "primary"}
        className="grid gap-5 md:grid-cols-2"
      >
        {displayedCourses.map((course) => {
          const courseTitle = localizedText(course.title, locale);

          return (
            <article
              key={course.id}
              className="group flex min-h-[360px] flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)] transition hover:-translate-y-1 hover:shadow-[0_22px_56px_var(--shadow-strong)]"
            >
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                    {courseTitle}
                  </h2>
                  {/* The sample cards' "第 1 / 12 单元, 8%" bar was template art,
                      not a record of anything: nobody had ever completed a unit
                      of these. It used to be hidden only once the visitor's own
                      classes appeared above it, which left the fabricated figure
                      showing to precisely the visitors who could not tell it was
                      fabricated - signed-out ones. It is gone for everyone. */}
                </div>

                <div
                  className={[
                    "flex min-h-28 items-center justify-between rounded-2xl border border-[var(--border)] p-4",
                    courseVisualClass[course.tone],
                  ].join(" ")}
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {t.common.nextUnit}
                    </p>
                    <p className="mt-2 max-w-xs text-lg font-semibold">
                      {localizedText(course.nextUnit, locale)}
                    </p>
                  </div>
                  <BookOpen size={52} weight="duotone" />
                </div>

                <p className="text-base leading-7 text-[var(--muted)]">
                  {localizedText(course.description, locale)}
                </p>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                      <ChalkboardTeacher size={18} weight="duotone" />
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        {localizedText(course.teacher, locale)}
                      </p>
                      <p className="text-sm leading-6 text-[var(--muted)]">
                        {localizedText(course.teacherHint, locale)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <Link
                href={createLearningHref(course.learningCourseId)}
                className="mt-6 inline-flex h-11 w-fit items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white shadow-[0_14px_28px_var(--shadow-accent)] outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              >
                {t.common.enterLearning}
                <ArrowRight size={17} weight="bold" />
              </Link>
            </article>
          );
        })}
      </section>
    </div>
  );
}
