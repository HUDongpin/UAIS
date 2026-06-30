"use client";

import { ArrowRight, BookOpen, ChalkboardTeacher, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { localizedText } from "@/components/ui/localized-text";
import { plazaCourses } from "@/data/uais";
import { copy } from "@/i18n/copy";

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

function parseProgress(progressText: string) {
  const match =
    /^Unit (\d+) of (\d+)$/.exec(progressText) ??
    /^第\s*(\d+)\s*\/\s*(\d+)\s*单元$/.exec(progressText);
  const current = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 1;
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return { current, total, percentage };
}

function createLearningHref(learningCourseId: string) {
  return `/learning?courseId=${encodeURIComponent(learningCourseId)}`;
}

type InviteCodeEntryState =
  | { status: "absent" }
  | { status: "valid"; inviteCode: string }
  | { status: "invalid" };

function readInitialInviteCodeEntry(): InviteCodeEntryState {
  if (typeof window === "undefined") {
    return { status: "absent" };
  }
  const searchParams = new URLSearchParams(window.location.search);
  if (!searchParams.has("invite")) {
    return { status: "absent" };
  }
  const inviteParam = searchParams.get("invite")?.trim() ?? "";
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(inviteParam)) {
    return { status: "valid", inviteCode: inviteParam };
  }

  return { status: "invalid" };
}

function createInviteJoinFailureMessage(
  body: InviteJoinResponse | undefined,
  traceId: string | undefined,
  locale: "zh-CN" | "en-US",
) {
  const reasonCode = body?.access?.reasonCode;
  const detail =
    reasonCode === "student-session-required"
      ? {
          "zh-CN": "需要登录学生账号。",
          "en-US": "Student sign-in is required.",
        }
      : undefined;
  const localizedDetail = detail ? localizedText(detail, locale) : body?.error;
  const baseMessage = localizedDetail
    ? locale === "zh-CN"
      ? `加入申请未提交：${localizedDetail}`
      : `Join request was not submitted: ${localizedDetail}`
    : locale === "zh-CN"
      ? "加入申请未提交，请稍后重试。"
      : "Join request was not submitted. Please retry later.";
  if (!traceId) {
    return baseMessage;
  }

  return locale === "zh-CN" ? `${baseMessage}追踪编号：${traceId}` : `${baseMessage} Trace ID: ${traceId}`;
}

type InviteJoinResponse = {
  membership?: {
    membershipStatus?: string;
  };
  error?: string;
  traceId?: string;
  access?: {
    reasonCode?: string;
  };
};

type InviteJoinStatus = {
  state: "idle" | "pending" | "success" | "failed";
  message?: string;
};

export function CoursePlazaPage() {
  const { locale } = useAppPreferences();
  const t = copy[locale];
  const [inviteCodeEntry] = useState(readInitialInviteCodeEntry);
  const inviteCode =
    inviteCodeEntry.status === "valid" ? inviteCodeEntry.inviteCode : undefined;
  const [inviteJoinStatus, setInviteJoinStatus] = useState<InviteJoinStatus>({ state: "idle" });
  const displayedCourses = [...plazaCourses].sort(
    (firstCourse, secondCourse) =>
      courseDisplayOrder[firstCourse.id] - courseDisplayOrder[secondCourse.id],
  );

  async function submitInviteJoin() {
    if (!inviteCode || inviteJoinStatus.state === "pending") {
      return;
    }

    setInviteJoinStatus({
      state: "pending",
      message:
        locale === "zh-CN"
          ? "正在提交加入申请，请稍候。"
          : "Submitting join request. Please wait.",
    });
    try {
      const response = await fetch(
        `/api/teaching/invite-codes/${encodeURIComponent(inviteCode)}/join`,
        {
          method: "POST",
          headers: { accept: "application/json" },
        },
      );
      const body = (await response.json().catch(() => undefined)) as InviteJoinResponse | undefined;
      const traceId = body?.traceId ?? response.headers.get("x-uais-trace-id") ?? undefined;
      if (!response.ok || !body?.membership) {
        setInviteJoinStatus({
          state: "failed",
          message: createInviteJoinFailureMessage(body, traceId, locale),
        });
        return;
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
      setInviteJoinStatus({
        state: "success",
        message: traceId
          ? locale === "zh-CN"
            ? `${baseMessage}追踪编号：${traceId}`
            : `${baseMessage} Trace ID: ${traceId}`
          : baseMessage,
      });
    } catch {
      setInviteJoinStatus({
        state: "failed",
        message:
          locale === "zh-CN"
            ? "加入申请未提交，请稍后重试。"
            : "Join request was not submitted. Please retry later.",
      });
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
          className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-medium text-rose-700 shadow-[0_18px_42px_var(--shadow)]"
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
              {inviteJoinStatus.message ? (
                <p
                  role={inviteJoinStatus.state === "failed" ? "alert" : "status"}
                  className={[
                    "mt-3 rounded-xl border px-3 py-2 text-sm font-medium",
                    inviteJoinStatus.state === "failed"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
                  ].join(" ")}
                >
                  {inviteJoinStatus.message}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={inviteJoinStatus.state === "pending"}
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
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 md:grid-cols-2">
        {displayedCourses.map((course) => {
          const progressText = localizedText(course.progressText, locale);
          const progress = parseProgress(progressText);
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
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-sm font-medium">
                      <span className="text-[var(--accent)]">{progressText}</span>
                      <span className="text-[var(--muted)]">{progress.percentage}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${courseTitle} progress`}
                      aria-valuemin={0}
                      aria-valuemax={progress.total}
                      aria-valuenow={progress.current}
                      aria-valuetext={`${progressText}, ${progress.percentage}%`}
                      className="h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]"
                    >
                      <div
                        className="h-full rounded-full bg-[var(--accent)] shadow-[0_4px_12px_var(--shadow-accent)]"
                        style={{ width: `${progress.percentage}%` }}
                      />
                      <span className="sr-only">{progress.percentage}%</span>
                    </div>
                  </div>
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
