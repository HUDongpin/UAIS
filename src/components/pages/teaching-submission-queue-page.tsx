"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { useAppPreferences } from "@/components/providers/app-preferences";
import type { Locale } from "@/i18n/copy";
import type { LearningSubmissionState } from "@/lib/learning-loop/domain";
import type { TeacherSubmissionQueueRow } from "./teaching-learning-loop-types";

type QueueFilter = "all" | LearningSubmissionState;

export function TeachingSubmissionQueuePage({ activityId }: { activityId: string }) {
  const { locale } = useAppPreferences();
  const zh = locale === "zh-CN";
  const [rows, setRows] = useState<TeacherSubmissionQueueRow[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [dataFreshAt, setDataFreshAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");

  const loadQueue = useCallback(async (cursor?: string, append = false) => {
    setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams({ limit: "25" });
      if (filter !== "all") search.set("state", filter);
      if (cursor) search.set("cursor", cursor);
      const response = await fetch(`/api/teaching/activities/${encodeURIComponent(activityId)}/submissions?${search}`, { cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!response.ok) throw new Error(typeof body.reasonCode === "string" ? body.reasonCode : "submission-queue-unavailable");
      const page = Array.isArray(body.submissions) ? body.submissions as TeacherSubmissionQueueRow[] : [];
      setSignedOut(false);
      setRows((current) => append ? [...current, ...page] : page);
      setNextCursor(typeof body.nextCursor === "string" ? body.nextCursor : null);
      setDataFreshAt(typeof body.dataFreshAt === "string" ? body.dataFreshAt : new Date().toISOString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "submission-queue-unavailable");
    } finally {
      setLoading(false);
    }
  }, [activityId, filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  if (signedOut) {
    return <main className="mx-auto mt-20 max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8"><p>{zh ? "教师会话已过期，请从教学工作台重新登录。" : "Your teacher session expired. Sign in again from My Teaching."}</p><Link href="/login" className="mt-3 inline-block font-semibold text-[var(--accent)] underline">{zh ? "前往登录" : "Go to sign in"}</Link></main>;
  }

  const filters: Array<{ value: QueueFilter; label: string }> = [
    { value: "all", label: zh ? "全部" : "All" },
    { value: "draft", label: zh ? "草稿中" : "Draft" },
    { value: "submitted", label: zh ? "已提交" : "Submitted" },
    { value: "revision_requested", label: zh ? "要求修订" : "Revision" },
    { value: "resubmitted", label: zh ? "已重新提交" : "Resubmitted" },
    { value: "accepted", label: zh ? "已接受" : "Accepted" },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 text-[var(--foreground)] sm:px-6">
      <header>
        <Link href="/teaching" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"><ArrowLeft size={16} />{zh ? "返回我的教学" : "Back to My Teaching"}</Link>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">P1 · {activityId}</p>
        <h1 className="mt-1 text-3xl font-semibold">{zh ? "真实提交队列" : "Real submission queue"}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{zh ? "本页只列出数据库中该任务的真实学生提交；不会使用演示姓名或静态数量。" : "This page lists only real database submissions for this activity—no demo names or static totals."}</p>
      </header>

      <div role="group" aria-label={zh ? "提交状态筛选" : "Submission state filter"} className="flex flex-wrap gap-2">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={filter === item.value ? "rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" : "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"}>{item.label}</button>)}</div>
      {dataFreshAt ? <p className="text-xs text-[var(--muted)]">{zh ? "数据新鲜度" : "Data fresh at"}: {formatHongKong(dataFreshAt, locale)}</p> : null}
      {error ? <div role="alert" className="rounded-xl border border-[var(--danger)] p-4 text-sm"><p>{error}</p><button type="button" onClick={() => void loadQueue()} className="mt-2 font-semibold text-[var(--accent)]">{zh ? "重试" : "Retry"}</button></div> : null}
      {loading && rows.length === 0 ? <p className="text-sm text-[var(--muted)]">{zh ? "正在读取真实提交…" : "Loading real submissions…"}</p> : null}
      {!loading && !error && rows.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">{zh ? "当前筛选下没有真实提交。" : "There are no real submissions in this filter."}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[var(--surface-elevated)] text-xs text-[var(--muted)]"><tr><th className="px-4 py-3">{zh ? "学生" : "Student"}</th><th className="px-4 py-3">{zh ? "班级" : "Class"}</th><th className="px-4 py-3">{zh ? "状态" : "State"}</th><th className="px-4 py-3">{zh ? "版本" : "Version"}</th><th className="px-4 py-3">{zh ? "形成性检查" : "Checkpoint"}</th><th className="px-4 py-3">{zh ? "更新时间" : "Updated"}</th><th className="px-4 py-3">{zh ? "操作" : "Action"}</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-[var(--border)]"><td className="px-4 py-3"><p className="font-semibold">{row.student.displayName || row.student.account}</p><p className="text-xs text-[var(--muted)]">{row.student.account}</p></td><td className="px-4 py-3">{row.classId}</td><td className="px-4 py-3"><span className="rounded-full bg-[var(--surface-elevated)] px-3 py-1 text-xs font-semibold">{stateLabel(row.state, zh)}</span></td><td className="px-4 py-3">V{row.currentVersionNo}</td><td className="px-4 py-3">{row.formative.attempted ? (zh ? `${row.formative.attemptCount} 次` : `${row.formative.attemptCount} attempt(s)`) : (zh ? "未尝试" : "Not attempted")}</td><td className="px-4 py-3 text-xs text-[var(--muted)]">{row.updatedAt ? formatHongKong(row.updatedAt, locale) : "—"}</td><td className="px-4 py-3"><Link href={`/teaching/submissions/${encodeURIComponent(row.id)}`} className="inline-flex items-center gap-2 font-semibold text-[var(--accent)]">{zh ? "审阅" : "Review"}<ArrowRight size={15} /></Link></td></tr>)}</tbody>
        </table>
      </div>
      {nextCursor ? <button type="button" disabled={loading} onClick={() => void loadQueue(nextCursor, true)} className="rounded-full border border-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent)] disabled:opacity-50">{loading ? (zh ? "读取中…" : "Loading…") : (zh ? "加载下一页" : "Load next page")}</button> : null}
    </div>
  );
}

function stateLabel(state: LearningSubmissionState, zh: boolean) { const labels: Record<LearningSubmissionState, [string, string]> = { draft: ["草稿中", "Draft"], submitted: ["已提交", "Submitted"], revision_requested: ["要求修订", "Revision requested"], resubmitted: ["已重新提交", "Resubmitted"], accepted: ["已接受", "Accepted"] }; return labels[state][zh ? 0 : 1]; }
function formatHongKong(value: string, locale: Locale) { return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
