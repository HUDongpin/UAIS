"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { useAppPreferences } from "@/components/providers/app-preferences";
import type { Locale } from "@/i18n/copy";
import { createLoginHandoffHref } from "@/lib/auth/login-return-path";
import type { LearningActivityDraft } from "@/lib/learning-loop/domain";
import {
  formatUtcForHongKongDateTimeInput,
  parseHongKongDateTimeInput,
} from "@/lib/learning-loop/hong-kong-time";
import { TeachingLearningActivityForm } from "./teaching-learning-activity-form";
import type {
  LearningInsights,
  TeacherCourseClass,
  TeacherLearningActivity,
} from "./teaching-learning-loop-types";

type Editor = {
  intent: "create" | "save" | "create-version";
  source?: TeacherLearningActivity;
  key: string;
};

type WorkspaceReadback = {
  activities?: TeacherLearningActivity[];
  classes?: Array<{ courseId?: string; classId?: string; className?: string }>;
  lessonKey?: string;
  insights?: LearningInsights;
};

export function TeachingLearningActivitiesPage({ courseId }: { courseId: string }) {
  const { locale } = useAppPreferences();
  const zh = locale === "zh-CN";
  const [activities, setActivities] = useState<TeacherLearningActivity[]>([]);
  const [classes, setClasses] = useState<TeacherCourseClass[]>([]);
  const [lessonKey, setLessonKey] = useState("");
  const [insights, setInsights] = useState<LearningInsights>();
  const [editor, setEditor] = useState<Editor>({ intent: "create", key: "create-0" });
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [activitiesResponse, coursesResponse, playbackResponse, insightsResponse] = await Promise.all([
        fetch(`/api/teaching/courses/${encodeURIComponent(courseId)}/activities`, { cache: "no-store", headers: { accept: "application/json" } }),
        fetch("/api/teaching/courses", { cache: "no-store", headers: { accept: "application/json" } }),
        fetch(`/api/learning/ppt-playback/${encodeURIComponent(courseId)}?locale=${encodeURIComponent(locale)}`, { cache: "no-store", headers: { accept: "application/json" } }),
        fetch(`/api/teaching/courses/${encodeURIComponent(courseId)}/learning-insights`, { cache: "no-store", headers: { accept: "application/json" } }),
      ]);
      if ([activitiesResponse, coursesResponse, playbackResponse].some((response) => response.status === 401)) {
        setSignedOut(true);
        return;
      }
      const activitiesBody = await readBody(activitiesResponse);
      const coursesBody = await readBody(coursesResponse);
      const playbackBody = await readBody(playbackResponse);
      const insightsBody = await readBody(insightsResponse);
      if (!activitiesResponse.ok || !coursesResponse.ok) {
        throw new Error(readReasonCode(activitiesBody) ?? readReasonCode(coursesBody) ?? "teacher-learning-workspace-unavailable");
      }
      setSignedOut(false);
      setActivities(readArray<TeacherLearningActivity>(activitiesBody.activities));
      setClasses(readArray<NonNullable<WorkspaceReadback["classes"]>[number]>(coursesBody.classes).filter((item) => item.courseId === courseId && item.classId).map((item) => ({ classId: item.classId!, className: item.className?.trim() || item.classId! })));
      setLessonKey(playbackResponse.ok && isRecord(playbackBody.playback) && isRecord(playbackBody.playback.learningUnit) && typeof playbackBody.playback.learningUnit.lessonKey === "string" ? playbackBody.playback.learningUnit.lessonKey : "");
      setInsights(insightsResponse.ok && isInsights(insightsBody) ? insightsBody : undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "teacher-learning-workspace-unavailable");
    } finally {
      setLoading(false);
    }
  }, [courseId, locale]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  async function createActivity(draft: LearningActivityDraft) {
    const body = await writeJson(`/api/teaching/courses/${encodeURIComponent(courseId)}/activities`, "POST", draft);
    assertActivityReadback(body);
    setActionMessage(zh ? "任务草稿已由服务端持久化。" : "The activity draft was persisted by the server.");
    setEditor({ intent: "create", key: `create-${crypto.randomUUID()}` });
    await loadWorkspace();
  }

  async function saveEditorDraft(draft: LearningActivityDraft) {
    if (!editor.source || editor.intent === "create") return createActivity(draft);
    const body = await writeJson(`/api/teaching/activities/${encodeURIComponent(editor.source.id)}`, "PATCH", {
      operation: editor.intent,
      expectedEditRevision: editor.source.editRevision,
      draft,
    });
    assertActivityReadback(body);
    setActionMessage(editor.intent === "save" ? (zh ? "任务修改已持久化。" : "Activity changes were persisted.") : (zh ? "新任务版本草稿已创建。" : "A new activity version draft was created."));
    setEditor({ intent: "create", key: `create-${crypto.randomUUID()}` });
    await loadWorkspace();
  }

  async function runActivityOperation(activity: TeacherLearningActivity, operation: "publish" | "archive", dueAt?: string | null) {
    setActionBusy(`${activity.id}:${operation}`);
    setActionMessage("");
    try {
      const body = await writeJson(`/api/teaching/activities/${encodeURIComponent(activity.id)}`, "PATCH", {
        operation: dueAt !== undefined ? "adjust-due-date" : operation,
        expectedEditRevision: activity.editRevision,
        ...(dueAt !== undefined ? { dueAt } : {}),
      });
      assertActivityReadback(body);
      setActionMessage(zh ? "状态已由数据库读回确认。" : "The database readback confirmed the new state.");
      await loadWorkspace();
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : (zh ? "操作失败。" : "Operation failed."));
    } finally {
      setActionBusy("");
    }
  }

  if (signedOut) {
    return <CenteredNotice><p>{zh ? "教师会话已过期。" : "Your teacher session expired."}</p><Link className="font-semibold text-[var(--accent)] underline" href={createLoginHandoffHref(`/teaching/courses/${courseId}/activities`)}>{zh ? "重新登录并返回" : "Sign in and return"}</Link></CenteredNotice>;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-[var(--foreground)] sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/teaching" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"><ArrowLeft size={16} />{zh ? "返回我的教学" : "Back to My Teaching"}</Link>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">P1 · {courseId}</p>
          <h1 className="mt-1 text-3xl font-semibold">{zh ? "学习任务与真实提交" : "Learning activities and real submissions"}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{zh ? "任务、提交、反馈和完成状态均来自 UAIS Postgres；播放课件本身不会把单元标记为完成。" : "Activities, submissions, feedback, and completion come from UAIS Postgres. Playing a lesson does not complete the unit."}</p>
        </div>
        <button type="button" onClick={() => void loadWorkspace()} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold">{zh ? "刷新真实数据" : "Refresh real data"}</button>
      </header>

      {loading ? <p className="text-sm text-[var(--muted)]">{zh ? "正在读取真实任务…" : "Loading real activities…"}</p> : null}
      {error ? <div role="alert" className="rounded-xl border border-[var(--danger)] p-4 text-sm"><p>{zh ? `工作台暂不可用：${error}` : `Workspace unavailable: ${error}`}</p><button type="button" onClick={() => void loadWorkspace()} className="mt-2 font-semibold text-[var(--accent)]">{zh ? "重试" : "Retry"}</button></div> : null}
      {!lessonKey && !loading ? <div className="rounded-xl border border-[var(--warning)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--muted)]">{zh ? "该课程尚无可绑定的已发布课件单元。新的 P1 课件必须在发布清单中显式提供 lessonKey 和 position。" : "This course has no published lesson identity to bind. New P1 manifests must provide lessonKey and position explicitly."}</div> : null}
      {classes.length === 0 && !loading ? <div className="rounded-xl border border-[var(--warning)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">{zh ? "该课程尚无真实班级；任务不能发布到虚构班级。" : "This course has no real class, so an activity cannot target an invented class."}</div> : null}

      {insights ? <InsightsPanel insights={insights} locale={locale} /> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-semibold">{zh ? "数据库中的任务" : "Activities in the database"}</h2><p className="mt-1 text-sm text-[var(--muted)]">{zh ? `${activities.length} 个真实任务版本` : `${activities.length} real activity versions`}</p></div>{editor.intent !== "create" ? <button type="button" onClick={() => setEditor({ intent: "create", key: `create-${crypto.randomUUID()}` })} className="rounded-full border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)]">{zh ? "新建独立任务" : "Create separate activity"}</button> : null}</div>
        {activities.length === 0 && !loading ? <p className="rounded-xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">{zh ? "还没有真实任务。请在下方创建第一项任务草稿。" : "No real activities yet. Create the first draft below."}</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">{activities.map((activity) => <ActivityCard key={activity.id} activity={activity} locale={locale} busy={actionBusy} onEdit={(source, intent) => setEditor({ source, intent, key: `${intent}-${source.id}-${source.editRevision}` })} onOperation={runActivityOperation} />)}</div>
      </section>

      {actionMessage ? <p aria-live="polite" className="rounded-xl bg-[var(--surface-elevated)] p-3 text-sm font-medium">{actionMessage}</p> : null}
      <TeachingLearningActivityForm key={editor.key} locale={locale} lessonKey={editor.source?.lessonKey ?? lessonKey} classes={classes} intent={editor.intent} source={editor.source} onSubmit={saveEditorDraft} onCancel={editor.intent === "create" ? undefined : () => setEditor({ intent: "create", key: `create-${crypto.randomUUID()}` })} />
    </div>
  );
}

function ActivityCard({ activity, locale, busy, onEdit, onOperation }: { activity: TeacherLearningActivity; locale: Locale; busy: string; onEdit: (activity: TeacherLearningActivity, intent: "save" | "create-version") => void; onOperation: (activity: TeacherLearningActivity, operation: "publish" | "archive", dueAt?: string | null) => Promise<void> }) {
  const zh = locale === "zh-CN";
  const [dueAt, setDueAt] = useState(activity.dueAt ? formatUtcForHongKongDateTimeInput(activity.dueAt) : "");
  const disabled = busy.startsWith(`${activity.id}:`);
  return <article className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><header className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--accent)]">{activity.lessonKey} · V{activity.version}</p><h3 className="mt-1 text-lg font-semibold">{activity.title[locale]}</h3><p className="mt-1 text-xs text-[var(--muted)]">{activity.targetClassId}</p></div><span className="rounded-full bg-[var(--surface-elevated)] px-3 py-1 text-xs font-semibold">{activityStatus(activity.status, zh)}</span></header><p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{activity.instructions[locale]}</p><div className="grid grid-cols-2 gap-2 text-xs"><Metric label={zh ? "量规" : "Rubric"} value={`${activity.rubric.length}`} /><Metric label={zh ? "形成性检查" : "Checkpoint"} value={activity.checkpoint.kind === "single-choice" ? (zh ? "单选" : "Choice") : (zh ? "短答" : "Short answer")} /></div><div className="flex gap-2"><input aria-label={`${activity.title[locale]} ${zh ? "截止时间" : "due time"}`} type="datetime-local" value={dueAt} disabled={activity.status === "archived"} onChange={(event) => setDueAt(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs" /><button type="button" disabled={disabled || activity.status === "archived"} onClick={() => void onOperation(activity, "publish", dueAt ? parseHongKongDateTimeInput(dueAt) : null)} className="rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-40">{zh ? "调整期限" : "Update due"}</button></div><div className="flex flex-wrap gap-2">{activity.status === "draft" ? <><button type="button" onClick={() => onEdit(activity, "save")} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold">{zh ? "编辑" : "Edit"}</button><button type="button" disabled={disabled} onClick={() => void onOperation(activity, "publish")} className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{zh ? "发布" : "Publish"}</button></> : null}{activity.status === "published" ? <><button type="button" onClick={() => onEdit(activity, "create-version")} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold">{zh ? "创建新版本" : "Create version"}</button><button type="button" disabled={disabled} onClick={() => void onOperation(activity, "archive")} className="rounded-full border border-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--danger)] disabled:opacity-40">{zh ? "归档" : "Archive"}</button></> : null}<Link href={`/teaching/activities/${encodeURIComponent(activity.id)}/submissions`} className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold">{zh ? "真实提交队列" : "Real submission queue"}<ArrowRight size={15} /></Link></div></article>;
}

function InsightsPanel({ insights, locale }: { insights: LearningInsights; locale: Locale }) { const zh = locale === "zh-CN"; const items = [[zh ? "未开始" : "Not started", insights.counts.notStarted], [zh ? "草稿中" : "Draft", insights.counts.draft], [zh ? "已提交" : "Submitted", insights.counts.submitted], [zh ? "要求修订" : "Revision", insights.counts.revisionRequested], [zh ? "已重新提交" : "Resubmitted", insights.counts.resubmitted], [zh ? "已接受" : "Accepted", insights.counts.accepted], [zh ? "已过期限" : "Overdue", insights.counts.overdue]] as const; return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{zh ? "真实学习洞察" : "Real learning insights"}</h2><p className="text-xs text-[var(--muted)]">projection V{insights.projectionVersion} · {formatHongKong(insights.dataFreshAt, locale)}</p></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{items.map(([label, value]) => <Metric key={label} label={label} value={String(value)} />)}</div></section>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-[var(--surface-elevated)] p-3"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
function CenteredNotice({ children }: { children: ReactNode }) { return <main className="mx-auto mt-20 max-w-xl space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-[var(--muted)]">{children}</main>; }

async function writeJson(url: string, method: "POST" | "PATCH", payload: unknown) { const response = await fetch(url, { method, headers: { "content-type": "application/json", "idempotency-key": `ui-${crypto.randomUUID()}` }, body: JSON.stringify(payload) }); const body = await readBody(response); if (!response.ok) throw new Error(readReasonCode(body) ?? `request-failed-${response.status}`); return body; }
function assertActivityReadback(body: Record<string, unknown>) { if (body.status !== "persisted" || !isRecord(body.activity) || typeof body.activity.id !== "string") throw new Error("activity-readback-required"); }
async function readBody(response: Response) { return (await response.json().catch(() => ({}))) as Record<string, unknown>; }
function readReasonCode(body: Record<string, unknown>) { return typeof body.reasonCode === "string" ? body.reasonCode : undefined; }
function readArray<T>(value: unknown): T[] { return Array.isArray(value) ? value as T[] : []; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isInsights(value: Record<string, unknown>): value is Record<string, unknown> & LearningInsights { return isRecord(value.counts) && typeof value.dataFreshAt === "string" && typeof value.projectionVersion === "number"; }
function activityStatus(status: TeacherLearningActivity["status"], zh: boolean) { const labels = { draft: ["草稿", "Draft"], published: ["已发布", "Published"], archived: ["已归档", "Archived"] } as const; return labels[status][zh ? 0 : 1]; }
function formatHongKong(value: string, locale: Locale) { return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
