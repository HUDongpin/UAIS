"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "@phosphor-icons/react/dist/ssr/Bell";
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";
import { createLoginHandoffHref } from "@/lib/auth/login-return-path";
import { openSamePageClassRoster } from "@/lib/teaching/class-roster-navigation";
import {
  HeaderActivityError,
  readHeaderCourseActivity,
  type HeaderActivityData,
  type HeaderActivityItem,
  type HeaderActivityMode,
} from "@/lib/header-course-activity";
import { copy, type Locale } from "@/i18n/copy";

const buttonClassName = "inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none transition hover:bg-[var(--surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const actionClassName = "inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50";

export function HeaderCourseActions({
  user, locale, onOpen,
}: {
  user: UaisAppSessionUser;
  locale: Locale;
  onOpen: () => void;
}) {
  const [mode, setMode] = useState<HeaderActivityMode | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const t = copy[locale].headerActivities;
  if (user.role !== "teacher" && user.role !== "student") return null;

  return (
    <div className="flex shrink-0 items-center" data-uais-header-course-actions>
      {(["calendar", "notifications"] as const).map((item) => (
        <button
          key={item}
          type="button"
          aria-label={t[item]}
          aria-haspopup="dialog"
          aria-expanded={mode === item}
          aria-controls={mode === item ? panelId : undefined}
          className={buttonClassName}
          onClick={(event) => {
            opener.current = event.currentTarget;
            onOpen();
            setMode(item);
          }}
        >
          {item === "calendar" ? <CalendarBlank size={19} weight="duotone" /> : <Bell size={19} weight="duotone" />}
        </button>
      ))}
      {mode ? (
        <CourseActivityDialog
          key={mode}
          id={panelId}
          mode={mode}
          user={user}
          locale={locale}
          onClose={(restoreFocus) => {
            setMode(null);
            if (restoreFocus) opener.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function CourseActivityDialog({
  id, mode, user, locale, onClose,
}: {
  id: string;
  mode: HeaderActivityMode;
  user: UaisAppSessionUser;
  locale: Locale;
  onClose: (restoreFocus: boolean) => void;
}) {
  const t = copy[locale].headerActivities;
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const navigating = useRef(false);
  const [data, setData] = useState<HeaderActivityData>();
  const [state, setState] = useState<"loading" | "ready" | "failed" | "denied">("loading");
  const [attempt, setAttempt] = useState(0);
  const { account, role, displayName, department } = user;

  useEffect(() => {
    const element = dialog.current;
    if (!element?.open) element?.showModal();
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readHeaderCourseActivity({
      user: { account, role, displayName, department }, mode, signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      setState("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setData(undefined);
      setState(error instanceof HeaderActivityError && [401, 403].includes(error.status) ? "denied" : "failed");
    });
    return () => controller.abort();
  }, [account, role, displayName, department, mode, attempt]);

  function refresh() {
    setData(undefined);
    setState("loading");
    setAttempt((value) => value + 1);
  }

  function onNavigate() {
    navigating.current = true;
    dialog.current?.close();
  }

  const summary = mode === "calendar"
    ? role === "teacher" ? t.teacherCalendarSummary : t.studentCalendarSummary
    : role === "teacher" ? t.teacherSummary : t.studentSummary;
  const empty = mode === "notifications"
    ? t.emptyNotifications
    : role === "teacher" ? t.emptyCalendar : t.emptyStudentCalendar;

  return (
    <dialog
      ref={dialog}
      id={id}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={() => onClose(!navigating.current)}
      onCancel={(event) => { event.preventDefault(); dialog.current?.close(); }}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[min(92vw,44rem)] max-w-none overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--foreground)] shadow-xl backdrop:bg-black/40"
      data-uais-header-dialog={mode}
    >
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="pt-2 text-xl font-semibold">{mode === "calendar" ? t.calendarTitle : t.notificationsTitle}</h2>
          <button ref={closeButton} type="button" aria-label={t.close} className={buttonClassName} onClick={() => dialog.current?.close()}>
            <X size={20} />
          </button>
        </div>
        <p id={descriptionId} className="text-sm leading-6 text-[var(--muted)]">{summary}</p>
        {state === "loading" ? <p role="status">{t.loading}</p> : null}
        {state === "failed" || state === "denied" ? <p role="alert">{t[state]}</p> : null}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={actionClassName} disabled={state === "loading"} onClick={refresh}>
            {state === "failed" || state === "denied" ? t.retry : t.refresh}
          </button>
          {state === "denied" ? (
            <Link href={createLoginHandoffHref(role === "student" ? "/student-dashboard" : "/teaching")} className={actionClassName}>
              {copy[locale].auth.signIn}
            </Link>
          ) : null}
        </div>
        {state === "ready" && data ? (
          <>
            <p className="text-xs text-[var(--muted)]">{t.observed}: {formatTime(data.observedAt, locale)}</p>
            {data.items.length ? (
              <ul className="space-y-3">
                {data.items.map((item) => (
                  <ActivityItem key={item.id} item={item} user={user} locale={locale} observedAt={data.observedAt} onNavigate={onNavigate} />
                ))}
              </ul>
            ) : <p>{empty}</p>}
          </>
        ) : null}
      </div>
    </dialog>
  );
}

function ActivityItem({
  item, user, locale, observedAt, onNavigate,
}: {
  item: HeaderActivityItem;
  user: UaisAppSessionUser;
  locale: Locale;
  observedAt: string;
  onNavigate: () => void;
}) {
  const t = copy[locale].headerActivities;
  const title = item.kind === "deadline"
    ? item.title?.[locale] ?? t.unit.replace("{n}", String(item.unitPosition))
    : t[item.kind];
  const link = user.role === "teacher"
    ? item.kind === "deadline" ? t.teacherCalendarLink : t.teacherNotificationsLink
    : item.kind.startsWith("membership-") ? t.studentMembershipLink : t.studentCourseLink;

  return (
    <li className="min-w-0 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4 [overflow-wrap:anywhere]" data-uais-header-item={item.id}>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-[var(--muted)]">
        {item.courseName} · {item.className}
        {item.unitPosition && item.kind !== "deadline" ? ` · ${t.unit.replace("{n}", String(item.unitPosition))}` : ""}
        {item.version ? ` · ${t.version} ${item.version}` : ""}
      </p>
      {item.dueAt ? (
        <p className="text-sm">
          <time dateTime={item.dueAt}>{formatTime(item.dueAt, locale)}</time>
          {Date.parse(item.dueAt) < Date.parse(observedAt) ? ` · ${t.past}` : ""}
        </p>
      ) : null}
      {item.count !== undefined ? <p className="text-sm">{t.count}: <span data-uais-header-count>{item.count}</span></p> : null}
      <Link
        href={item.href}
        prefetch={false}
        className="inline-flex min-h-11 items-center rounded-full px-1 text-sm font-semibold text-[var(--accent)] underline underline-offset-4 focus-visible:outline-2"
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          onNavigate();
          if (item.kind === "pending-approval" && openSamePageClassRoster(item.href)) event.preventDefault();
        }}
      >
        {link}
      </Link>
    </li>
  );
}

function formatTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}
