"use client";

import { useEffect, useState } from "react";
import { classroomRecordRetentionCopy, type Locale } from "@/i18n/copy";
import type { ClassroomRecordRetentionState } from "@/lib/server/classroom-record-retention-store";

type Props = { courseId: string; locale: Locale };
export function CourseRecordRetentionPanel(props: Props) {
  return <CourseRetentionContent key={props.courseId} {...props} />;
}

function CourseRetentionContent({ courseId, locale }: Props) {
  const t = classroomRecordRetentionCopy[locale];
  const endpoint = `/api/teaching/courses/${encodeURIComponent(courseId)}/retention`;
  const [state, setState] = useState<ClassroomRecordRetentionState>();
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [backendRequired, setBackendRequired] = useState(false);
  const [confirmation, setConfirmation] = useState<"close" | "purge" | null>(
    null,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchRetention(endpoint, courseId)
      .then((result) => {
        if (!cancelled) {
          setState(result);
          setFailed(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailed(true);
          setBackendRequired(isBackendRequired(error));
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, endpoint]);
  async function refresh(preview = false) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setBackendRequired(false);
    setAcknowledged(false);
    setConfirmation(null);
    try {
      const result = await fetchRetention(endpoint, courseId);
      setState(result);
      if (preview && result.eligibleForPurge) setConfirmation("purge");
    } catch (error) {
      setFailed(true);
      setBackendRequired(isBackendRequired(error));
    } finally {
      setBusy(false);
    }
  }
  async function execute(action: "close" | "purge") {
    if (busy || !state || (action === "purge" && !acknowledged)) return;
    setBusy(true);
    setFailed(false);
    setBackendRequired(false);
    try {
      const result = await fetchRetention(endpoint, courseId, {
        action,
        confirm: true,
        ...(action === "purge"
          ? { confirmationDigest: state.confirmationDigest }
          : {}),
      });
      setState(result);
      setConfirmation(null);
      setAcknowledged(false);
    } catch (error) {
      setFailed(true);
      setBackendRequired(isBackendRequired(error));
      setConfirmation(null);
    } finally {
      setBusy(false);
    }
  }
  const button =
    "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  return (
    <section
      className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-label={t.title}
    >
      <h3 className="font-semibold">{t.title}</h3>
      <p className="text-sm leading-6 text-[var(--muted)]">{t.help}</p>
      <p className="text-xs leading-5 text-[var(--muted)]">{t.boundary}</p>
      {busy ? (
        <p role="status" className="text-sm">
          {state ? t.busy : t.loading}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {backendRequired ? t.backendRequired : t.failed}
        </p>
      ) : null}
      {state ? (
        <>
          {state.purgedAt ? (
            <p role="status">
              {t.purged} · {date(state.purgedAt)}
            </p>
          ) : state.closedAt && state.purgeAfter ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">{t.closed}</dt>
                <dd>{date(state.closedAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">{t.due}</dt>
                <dd>{date(state.purgeAfter)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm">{t.active}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {!state.closedAt ? (
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => setConfirmation("close")}
              >
                {t.close}
              </button>
            ) : null}
            {state.eligibleForPurge ? (
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => void refresh(true)}
              >
                {t.preview}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              className={button}
              onClick={() => void refresh()}
            >
              {t.refresh}
            </button>
          </div>
          {confirmation === "close" ? (
            <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
              <p className="text-sm">{t.closeWarning}</p>
              <button
                type="button"
                disabled={busy}
                className={button}
                onClick={() => void execute("close")}
              >
                {t.closeConfirm}
              </button>
              <button
                type="button"
                disabled={busy}
                className={`${button} ml-2`}
                onClick={() => setConfirmation(null)}
              >
                {t.cancel}
              </button>
            </div>
          ) : null}
          {confirmation === "purge" ? (
            <div className="space-y-3 rounded-xl border border-[var(--danger)] p-3">
              <h4 className="text-sm font-semibold">{t.previewTitle}</h4>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(state.counts).map(([key, count]) => (
                  <div key={key}>
                    <dt className="text-[var(--muted)]">
                      {t.labels[key as keyof typeof t.labels] ?? key}
                    </dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                {t.acknowledge}
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !acknowledged}
                  className={`${button} text-[var(--danger)]`}
                  onClick={() => void execute("purge")}
                >
                  {t.purgeConfirm}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={button}
                  onClick={() => setConfirmation(null)}
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : !busy ? (
        <button type="button" className={button} onClick={() => void refresh()}>
          {t.refresh}
        </button>
      ) : null}
    </section>
  );
}

async function fetchRetention(
  endpoint: string,
  courseId: string,
  body?: Record<string, unknown>,
): Promise<ClassroomRecordRetentionState> {
  const response = await fetch(
    endpoint,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = (await response.json()) as {
    retention?: ClassroomRecordRetentionState;
    reasonCode?: string;
  };
  if (!response.ok)
    throw new Error(result.reasonCode ?? "retention-unconfirmed");
  if (
    !response.ok ||
    result.retention?.courseId !== courseId ||
    !result.retention.counts ||
    typeof result.retention.confirmationDigest !== "string"
  )
    throw new Error("retention-unconfirmed");
  return result.retention;
}

function isBackendRequired(error: unknown) {
  return (
    error instanceof Error &&
    error.message === "course-retention-postgres-required"
  );
}
