"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { useAppPreferences } from "@/components/providers/app-preferences";
import type { Locale } from "@/i18n/copy";
import type { LearningSubmissionState } from "@/lib/learning-loop/domain";
import type { TeacherSubmissionQueueCounts, TeacherSubmissionQueueRow } from "./teaching-learning-loop-types";

type QueueFilter = "all" | LearningSubmissionState;

export function TeachingSubmissionQueuePage({ activityId }: { activityId: string }) {
  const { locale } = useAppPreferences();
  const zh = locale === "zh-CN";
  const [rows, setRows] = useState<TeacherSubmissionQueueRow[]>([]);
  const [counts, setCounts] = useState<TeacherSubmissionQueueCounts | null>(null);
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
      setCounts(body.counts && typeof body.counts === "object" ? body.counts as TeacherSubmissionQueueCounts : null);
      setNextCursor(typeof body.nextCursor === "string" ? body.nextCursor : null);
      setDataFreshAt(typeof body.dataFreshAt === "string" ? body.dataFreshAt : "");
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
        <p className="mt-5 text-xs font-semibold text-[var(--accent)]">{zh ? "作业评阅" : "Assignment review"}</p>
        <h1 className="mt-1 text-3xl font-semibold">{zh ? "学生提交" : "Student submissions"}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{zh ? "查看本任务的学生提交，选择一份作业进行评阅、反馈或要求修订。" : "Review submissions for this activity, provide feedback, or request a revision."}</p>
      </header>

      {counts ? <section aria-label={zh ? "全班作业概况" : "Class submission overview"} className="space-y-3">
        <p className="text-sm text-[var(--muted)]">{zh ? `${counts.totalStudents} 位已批准加入目标班级的学生 · 全部人数，不受下方筛选或分页影响` : `${counts.totalStudents} approved students in the target class · Totals are independent of filters and pagination`}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: zh ? "未交" : "Not submitted", value: counts.notSubmitted },
            { label: zh ? "已交" : "Submitted", value: counts.submitted },
            { label: zh ? "待修订" : "Revision needed", value: counts.revisionRequested },
            { label: zh ? "已反馈" : "Feedback received", value: counts.feedbackReleased },
          ].map(({ label, value }) => <div key={label} aria-label={zh ? `${label}人数` : `${label} count`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 text-2xl font-semibold">{value}</dd></div>)}
        </dl>
        <p className="text-xs leading-5 text-[var(--muted)]">{zh ? `未交与已交合计为全班人数。未交包含尚未开始和当前草稿；已交中有 ${counts.awaitingReview} 人待评阅。待修订包含正在修改的草稿；已反馈表示曾收到教师发布的反馈，这两项人数可能重叠。` : `Not submitted and submitted add up to the class total. Not submitted includes students who have not started and current drafts; ${counts.awaitingReview} submitted students await review. Revision needed includes drafts being revised. Feedback received means teacher feedback has been released at least once; these indicators can overlap.`}</p>
      </section> : null}

      <div role="group" aria-label={zh ? "提交状态筛选" : "Submission state filter"} className="flex flex-wrap gap-2">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={filter === item.value ? "rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" : "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"}>{item.label}</button>)}</div>
      {dataFreshAt ? <p className="text-xs text-[var(--muted)]">{zh ? "更新于" : "Updated at"}: {formatHongKong(dataFreshAt, locale)}</p> : null}
      {error ? <div role="alert" className="rounded-xl border border-[var(--danger)] p-4 text-sm"><p>{error}</p><button type="button" onClick={() => void loadQueue()} className="mt-2 font-semibold text-[var(--accent)]">{zh ? "重试" : "Retry"}</button></div> : null}
      {loading && rows.length === 0 ? <p className="text-sm text-[var(--muted)]">{zh ? "正在读取提交…" : "Loading submissions…"}</p> : null}
      {!loading && !error && rows.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">{zh ? "当前筛选下没有提交记录。" : "There are no submissions in this filter."}</p> : null}

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
