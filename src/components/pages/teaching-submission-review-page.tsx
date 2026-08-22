"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { useAppPreferences } from "@/components/providers/app-preferences";
import type { Locale } from "@/i18n/copy";
import type { RubricJudgmentState } from "@/lib/learning-loop/domain";
import type {
  TeacherFeedback,
  TeacherSubmissionDetail,
  TeacherSubmissionVersion,
} from "./teaching-learning-loop-types";

const judgmentOptions: RubricJudgmentState[] = [
  "not-reviewed",
  "met",
  "partly-met",
  "needs-revision",
];

export function TeachingSubmissionReviewPage({ submissionId }: { submissionId: string }) {
  const { locale } = useAppPreferences();
  const zh = locale === "zh-CN";
  const [submission, setSubmission] = useState<TeacherSubmissionDetail>();
  const [feedbackText, setFeedbackText] = useState("");
  const [judgments, setJudgments] = useState<Record<string, RubricJudgmentState>>({});
  const [origin, setOrigin] = useState<"teacher" | "ai-assisted">("teacher");
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "ai" | "request-revision" | "accept">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadSubmission = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/teaching/submissions/${encodeURIComponent(submissionId)}`, { cache: "no-store", headers: { accept: "application/json" } });
      const body = await readBody(response);
      if (response.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!response.ok || !isSubmission(body.submission)) throw new Error(readReason(body) ?? "teacher-submission-unavailable");
      setSignedOut(false);
      applySubmission(body.submission, { setSubmission, setFeedbackText, setJudgments, setOrigin, setFeedbackRevision });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "teacher-submission-unavailable");
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSubmission(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSubmission]);

  async function saveFeedbackDraft() {
    if (!submission) return;
    setBusy("save");
    setError("");
    setMessage("");
    try {
      await writeJson(`/api/teaching/submissions/${encodeURIComponent(submission.id)}/feedback`, "PUT", {
        expectedSubmissionVersionId: submission.currentVersionId,
        expectedFeedbackRevision: feedbackRevision,
        feedbackText,
        rubricJudgments: judgments,
        origin,
      });
      setMessage(zh ? "反馈草稿已由服务端持久化；学生仍不可见。" : "The feedback draft was persisted and remains hidden from the student.");
      await loadSubmission();
    } catch (caught) {
      setError(errorMessage(caught, locale));
    } finally {
      setBusy("");
    }
  }

  async function generateAiDraft() {
    if (!submission) return;
    setBusy("ai");
    setError("");
    setMessage("");
    try {
      await writeJson(`/api/teaching/submissions/${encodeURIComponent(submission.id)}/ai-feedback-draft`, "POST", {
        expectedSubmissionVersionId: submission.currentVersionId,
        expectedFeedbackRevision: feedbackRevision,
      });
      setMessage(zh ? "AI 辅助草稿已保存，必须由教师检查、修改并主动发布。" : "The AI-assisted draft was saved. A teacher must inspect, edit, and explicitly release it.");
      await loadSubmission();
    } catch (caught) {
      setError(errorMessage(caught, locale, true));
    } finally {
      setBusy("");
    }
  }

  async function decide(decision: "request-revision" | "accept") {
    if (!submission || !feedbackText.trim()) {
      setError(zh ? "发布决定必须包含非空的教师确认反馈。" : "A released decision requires non-empty teacher-confirmed feedback.");
      return;
    }
    setBusy(decision);
    setError("");
    setMessage("");
    try {
      await writeJson(`/api/teaching/submissions/${encodeURIComponent(submission.id)}/decision`, "POST", {
        expectedSubmissionVersionId: submission.currentVersionId,
        decision,
        feedbackText,
        rubricJudgments: judgments,
        origin,
      });
      setMessage(decision === "accept" ? (zh ? "反馈与接受决定已在同一事务中发布；该单元现在完成。" : "Feedback and acceptance were released in one transaction; the unit is now complete.") : (zh ? "反馈与修订要求已在同一事务中发布。" : "Feedback and the revision request were released in one transaction."));
      await loadSubmission();
    } catch (caught) {
      setError(errorMessage(caught, locale));
    } finally {
      setBusy("");
    }
  }

  if (signedOut) {
    return <main className="mx-auto mt-20 max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8"><p>{zh ? "教师会话已过期。" : "Your teacher session expired."}</p><Link href="/login" className="mt-3 inline-block font-semibold text-[var(--accent)] underline">{zh ? "重新登录" : "Sign in again"}</Link></main>;
  }

  const canDecide = submission?.state === "submitted" || submission?.state === "resubmitted";
  const currentVersion = submission?.versions.find((item) => item.id === submission.currentVersionId);
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-[var(--foreground)] sm:px-6">
      <header>
        <Link href={submission ? `/teaching/activities/${encodeURIComponent(submission.activityId)}/submissions` : "/teaching"} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent)]"><ArrowLeft size={16} />{zh ? "返回提交队列" : "Back to submission queue"}</Link>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">P1 · {submissionId}</p>
        <h1 className="mt-1 text-3xl font-semibold">{zh ? "审阅封存学习产物" : "Review sealed learning evidence"}</h1>
      </header>

      {loading && !submission ? <p className="text-sm text-[var(--muted)]">{zh ? "正在读取真实提交…" : "Loading the real submission…"}</p> : null}
      {error ? <div role="alert" className="rounded-xl border border-[var(--danger)] p-4 text-sm"><p>{error}</p><p className="mt-1 text-xs text-[var(--muted)]">{zh ? "AI 失败不会阻断下方人工反馈路径。" : "An AI failure does not block the manual feedback path below."}</p><button type="button" onClick={() => void loadSubmission()} className="mt-2 font-semibold text-[var(--accent)]">{zh ? "重新读取当前版本" : "Reload current version"}</button></div> : null}
      {message ? <p aria-live="polite" className="rounded-xl bg-[var(--accent-soft)] p-4 text-sm font-medium">{message}</p> : null}

      {submission ? (
        <>
          <section className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:grid-cols-2 lg:grid-cols-5">
            <Summary label={zh ? "学生" : "Student"} value={submission.student.displayName || submission.student.account} />
            <Summary label={zh ? "班级" : "Class"} value={submission.classId} />
            <Summary label={zh ? "当前状态" : "Current state"} value={stateLabel(submission.state, zh)} />
            <Summary label={zh ? "当前版本" : "Current version"} value={`V${submission.currentVersionNo}`} />
            <Summary label={zh ? "形成性检查" : "Checkpoint"} value={submission.formative.attempted ? (zh ? `${submission.formative.attemptCount} 次真实尝试` : `${submission.formative.attemptCount} real attempt(s)`) : (zh ? "未尝试" : "Not attempted")} />
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-xs font-semibold text-[var(--accent)]">{submission.lessonKey}</p><h2 className="mt-1 text-xl font-semibold">{submission.activity.title[locale]}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{submission.activity.instructions[locale]}</p></div>
              {submission.versions.map((version) => <VersionCard key={version.id} version={version} current={version.id === submission.currentVersionId} feedback={submission.feedback.filter((item) => item.submissionVersionId === version.id && item.status !== "draft")} locale={locale} />)}
            </section>

            <aside className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 lg:sticky lg:top-20">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{origin === "ai-assisted" ? (zh ? "AI 辅助 · 教师必须确认" : "AI-assisted · teacher confirmation required") : (zh ? "教师人工反馈" : "Teacher-authored feedback")}</p><h2 className="mt-1 text-xl font-semibold">{zh ? `针对 V${submission.currentVersionNo}` : `For V${submission.currentVersionNo}`}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{zh ? "草稿不会出现在学生 API 中。提交版本变化后，服务端会拒绝发布旧版本草稿。" : "Drafts never appear in the student API. The server rejects a draft if the submission version has changed."}</p></div>
              <div className="space-y-3">{submission.activity.rubric.map((dimension) => <label key={dimension.id} className="block text-sm font-semibold"><span className="mb-1 block">{dimension.label[locale]}</span><select disabled={!canDecide} value={judgments[dimension.id] ?? "not-reviewed"} onChange={(event) => setJudgments({ ...judgments, [dimension.id]: event.target.value as RubricJudgmentState })} className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm disabled:opacity-60">{judgmentOptions.map((value) => <option key={value} value={value}>{judgmentLabel(value, zh)}</option>)}</select></label>)}</div>
              <label className="block text-sm font-semibold"><span className="mb-2 block">{zh ? "教师确认反馈" : "Teacher-confirmed feedback"}</span><textarea rows={10} readOnly={!canDecide} value={feedbackText} onChange={(event) => setFeedbackText(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-[var(--accent)] read-only:opacity-60" /></label>
              <div className="flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy) || !canDecide || !currentVersion || currentVersion.status !== "sealed" || submission.activity.aiPolicy !== "teacher-requested-draft"} onClick={() => void generateAiDraft()} className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-40"><Robot size={17} />{busy === "ai" ? (zh ? "生成中…" : "Generating…") : submission.activity.aiPolicy === "disabled" ? (zh ? "本任务已禁用 AI 草稿" : "AI drafts disabled for this activity") : (zh ? "按需生成 AI 草稿" : "Generate AI draft on demand")}</button><button type="button" disabled={Boolean(busy) || !canDecide} onClick={() => void saveFeedbackDraft()} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-40">{busy === "save" ? (zh ? "保存中…" : "Saving…") : (zh ? "保存教师草稿" : "Save teacher draft")}</button></div>
              {canDecide ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><button type="button" disabled={Boolean(busy) || !feedbackText.trim()} onClick={() => void decide("request-revision")} className="rounded-xl border border-[var(--warning)] px-4 py-3 text-sm font-semibold disabled:opacity-40">{busy === "request-revision" ? (zh ? "发布中…" : "Releasing…") : (zh ? "发布反馈并要求修订" : "Release and request revision")}</button><button type="button" disabled={Boolean(busy) || !feedbackText.trim()} onClick={() => void decide("accept")} className="rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy === "accept" ? (zh ? "接受中…" : "Accepting…") : (zh ? "发布反馈并接受" : "Release and accept")}</button></div> : <p className="rounded-xl bg-[var(--surface-elevated)] p-3 text-sm text-[var(--muted)]">{submission.state === "accepted" ? (zh ? "该版本已接受，是 P1 终态；普通界面不提供静默重开。" : "This version is accepted, the P1 terminal state. The normal UI cannot silently reopen it.") : (zh ? "等待学生提交新版本后才能作出下一次决定。" : "Wait for the student to submit a new version before the next decision.")}</p>}
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

function VersionCard({ version, current, feedback, locale }: { version: TeacherSubmissionVersion; current: boolean; feedback: TeacherFeedback[]; locale: Locale }) { const zh = locale === "zh-CN"; return <article className={current ? "rounded-2xl border-2 border-[var(--accent)] bg-[var(--surface)] p-5" : "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"}><header className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">V{version.versionNo} · {version.status === "sealed" ? (zh ? "已封存" : "Sealed") : (zh ? "草稿" : "Draft")}</h2>{current ? <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">{zh ? "当前版本" : "Current"}</span> : null}</header><pre className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-[var(--surface-elevated)] p-4 font-sans text-sm leading-6 text-[var(--foreground)]">{version.contentText}</pre>{feedback.length ? <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4"><h3 className="text-sm font-semibold">{zh ? "该版本已发布反馈" : "Released feedback for this version"}</h3>{feedback.map((item) => <div key={item.id} className="rounded-lg bg-[var(--accent-soft)] p-3 text-sm leading-6"><p className="whitespace-pre-wrap">{item.feedbackText}</p><p className="mt-2 text-xs text-[var(--muted)]">{item.requiresRevision ? (zh ? "要求修订" : "Revision requested") : (zh ? "教师接受" : "Teacher accepted")}</p></div>)}</div> : null}</article>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[var(--surface-elevated)] p-3"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }

type ApplySetters = { setSubmission: (value: TeacherSubmissionDetail) => void; setFeedbackText: (value: string) => void; setJudgments: (value: Record<string, RubricJudgmentState>) => void; setOrigin: (value: "teacher" | "ai-assisted") => void; setFeedbackRevision: (value: number) => void };
function applySubmission(submission: TeacherSubmissionDetail, setters: ApplySetters) { const draft = [...submission.feedback].reverse().find((item) => item.status === "draft" && item.submissionVersionId === submission.currentVersionId); const defaults = Object.fromEntries(submission.activity.rubric.map((item) => [item.id, "not-reviewed" as const])); setters.setSubmission(submission); setters.setFeedbackText(draft?.feedbackText ?? ""); setters.setJudgments(draft?.rubricJudgments ?? defaults); setters.setOrigin(draft?.origin ?? "teacher"); setters.setFeedbackRevision(draft?.sourceDraftRevision ?? 0); }
async function writeJson(url: string, method: "POST" | "PUT", payload: unknown) { const response = await fetch(url, { method, headers: { "content-type": "application/json", "idempotency-key": `ui-${crypto.randomUUID()}` }, body: JSON.stringify(payload) }); const body = await readBody(response); if (!response.ok) { const reason = readReason(body) ?? `request-failed-${response.status}`; const error = new Error(reason); error.name = response.status === 409 ? "ConflictError" : "RequestError"; throw error; } if (body.status !== "persisted") throw new Error("persisted-readback-required"); return body; }
async function readBody(response: Response) { return await response.json().catch(() => ({})) as Record<string, unknown>; }
function readReason(body: Record<string, unknown>) { return typeof body.reasonCode === "string" ? body.reasonCode : undefined; }
function isSubmission(value: unknown): value is TeacherSubmissionDetail { return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && Array.isArray((value as { versions?: unknown }).versions); }
function errorMessage(caught: unknown, locale: Locale, ai = false) { const reason = caught instanceof Error ? caught.message : "request-failed"; if (ai) return locale === "zh-CN" ? `AI 草稿不可用（${reason}）；不会自动重试或发布，请继续使用人工反馈。` : `AI draft unavailable (${reason}). It will not retry or publish automatically; continue with manual feedback.`; return locale === "zh-CN" ? `操作未完成（${reason}）；请重新读取当前版本后再试。` : `The operation did not complete (${reason}). Reload the current version before retrying.`; }
function stateLabel(state: TeacherSubmissionDetail["state"], zh: boolean) { const labels = { draft: ["草稿中", "Draft"], submitted: ["已提交", "Submitted"], revision_requested: ["要求修订", "Revision requested"], resubmitted: ["已重新提交", "Resubmitted"], accepted: ["已接受", "Accepted"] } as const; return labels[state][zh ? 0 : 1]; }
function judgmentLabel(value: RubricJudgmentState, zh: boolean) { const labels: Record<RubricJudgmentState, [string, string]> = { "not-reviewed": ["未审阅", "Not reviewed"], met: ["达到", "Met"], "partly-met": ["部分达到", "Partly met"], "needs-revision": ["需要修订", "Needs revision"] }; return labels[value][zh ? 0 : 1]; }
