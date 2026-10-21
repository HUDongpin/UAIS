"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { copy, type Locale } from "@/i18n/copy";
import { createLoginHandoffHref } from "@/lib/auth/login-return-path";
import type { LearningInsights } from "./teaching-learning-loop-types";

type Props = {
  operationId: "dashboard" | "quiz-board";
  courseId?: string;
  classId?: string;
  locale: Locale;
};

type Readback =
  | { status: "loading" }
  | { status: "error"; reason: "failed" | "signedOut" | "denied" }
  | { status: "ready"; insights: LearningInsights; retrievedAt: string };

const stateKeys = [
  "notStarted", "draft", "submitted", "revisionRequested", "resubmitted", "accepted",
] as const;

// Reset the entire readback when its scope changes, including before effects run.
export function TeachingDashboardInsights(props: Props) {
  // The API trims the optional class query and treats an empty query as absent.
  const classId = props.classId?.trim() || undefined;
  return <DashboardReadback key={JSON.stringify([props.operationId, props.courseId, classId])} {...props} classId={classId} />;
}

function DashboardReadback({ operationId, courseId, classId, locale }: Props) {
  const text = copy[locale].teachingInsights;
  const [readback, setReadback] = useState<Readback>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!courseId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const query = classId ? `?${new URLSearchParams({ class: classId })}` : "";
        const response = await fetch(
          `/api/teaching/courses/${encodeURIComponent(courseId!)}/learning-insights${query}`,
          { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setReadback({
            status: "error",
            reason: response.status === 401 ? "signedOut" : response.status === 403 ? "denied" : "failed",
          });
          return;
        }
        const body: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!isInsights(body, courseId!, classId)) throw new Error("invalid-learning-insights");
        setReadback({ status: "ready", insights: body, retrievedAt: new Date().toISOString() });
      } catch {
        if (!controller.signal.aborted) setReadback({ status: "error", reason: "failed" });
      }
    }
    void load();
    return () => controller.abort();
  }, [courseId, classId, refresh]);

  const insights = courseId && readback.status === "ready" ? readback.insights : undefined;
  const total = insights ? stateKeys.reduce((sum, key) => sum + insights.counts[key], 0) : 0;
  const rate = (count: number) => total > 0 ? `${Math.round(count / total * 100)}%` : "—";
  const counts = insights?.counts;
  const metrics = operationId === "dashboard"
    ? [
        { label: text.started, value: counts ? rate(total - counts.notStarted) : "—", note: text.startedNote },
        { label: text.accepted, value: counts ? rate(counts.accepted) : "—", note: text.acceptedNote },
        { label: text.overdue, value: counts ? String(counts.overdue) : "—", note: text.overdueNote },
      ]
    : [
        { label: text.submitted, value: counts ? rate(counts.submitted + counts.revisionRequested + counts.resubmitted + counts.accepted) : "—", note: text.submittedNote },
        { label: text.lowQuality, value: text.unavailable, note: text.lowQualityNote },
        { label: text.clusters, value: text.unavailable, note: text.clustersNote },
      ];
  const stateLabels = [
    text.notStartedState, text.draftState, text.submittedState,
    text.revisionState, text.resubmittedState, text.acceptedState,
  ];
  const loading = Boolean(courseId) && readback.status === "loading";
  const returnQuery = new URLSearchParams({
    ...(courseId ? { course: courseId } : {}),
    ...(classId ? { class: classId } : {}),
  });

  return (
    <section className="mt-5 space-y-4" aria-label={operationId === "dashboard" ? text.refreshDashboard : text.refreshQuiz}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!courseId || loading}
          onClick={() => { setReadback({ status: "loading" }); setRefresh((value) => value + 1); }}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white outline-none hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ArrowClockwise size={18} />
          {operationId === "dashboard" ? text.refreshDashboard : text.refreshQuiz}
        </button>
        {courseId ? <Link href={`/teaching/courses/${encodeURIComponent(courseId)}/activities`} className="inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">{text.openActivities}</Link> : null}
      </div>
      <p className="text-sm leading-6 text-[var(--muted)]">{text.scope}</p>
      {classId ? <p className="text-sm text-[var(--muted)]">{text.classScope}：{classId}</p> : null}
      <div aria-live="polite" aria-busy={loading}>
        {!courseId ? <p className="text-sm text-[var(--muted)]">{text.selectCourse}</p> : null}
        {loading ? <p className="text-sm text-[var(--muted)]">{text.loading}</p> : null}
        {courseId && readback.status === "error" ? (
          <div role="alert" className="rounded-xl border border-[var(--danger)] p-4 text-sm text-[var(--foreground)]">
            <p>{text[readback.reason]}</p>
            {readback.reason === "signedOut" ? <Link className="mt-2 inline-flex min-h-11 items-center font-semibold text-[var(--accent)] underline" href={createLoginHandoffHref(`/teaching/${operationId}?${returnQuery}`)}>{text.signIn}</Link> : null}
          </div>
        ) : null}
        {insights && readback.status === "ready" ? (
          <div className="space-y-1 text-xs text-[var(--muted)]">
            <p>{text.dataFreshAt}：<time dateTime={insights.dataFreshAt}>{formatTime(insights.dataFreshAt, locale)}</time></p>
            <p>{text.refreshedAt}：<time dateTime={readback.retrievedAt}>{formatTime(readback.retrievedAt, locale)}</time></p>
            {total === 0 ? <p className="pt-2 text-sm">{text.empty}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
            <p className="text-xs font-semibold text-[var(--muted)]">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{metric.value}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{metric.note}</p>
          </article>
        ))}
      </div>
      {counts ? (
        <section className="space-y-3">
          <h3 className="font-semibold text-[var(--foreground)]">{text.stateTitle}</h3>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stateKeys.map((key, index) => <div key={key} className="rounded-xl bg-[var(--surface-elevated)] p-3"><dt className="text-xs text-[var(--muted)]">{stateLabels[index]}</dt><dd className="mt-1 font-semibold text-[var(--foreground)]">{counts[key]}</dd></div>)}
          </dl>
        </section>
      ) : null}
    </section>
  );
}

function isInsights(value: unknown, courseId: string, classId?: string): value is LearningInsights {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (body.courseId !== courseId || body.classId !== classId) return false;
  if (typeof body.dataFreshAt !== "string" || !Number.isFinite(Date.parse(body.dataFreshAt))) return false;
  if (!Number.isSafeInteger(body.projectionVersion) || (body.projectionVersion as number) < 0) return false;
  if (!body.counts || typeof body.counts !== "object" || Array.isArray(body.counts)) return false;
  const counts = body.counts as Record<string, unknown>;
  return [...stateKeys, "overdue"].every((key) => Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0)
    && Number.isSafeInteger(stateKeys.reduce((sum, key) => sum + (counts[key] as number), 0));
}

function formatTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}
