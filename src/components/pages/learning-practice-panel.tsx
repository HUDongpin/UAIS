"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionUser } from "@/components/providers/session-user";
import type { Locale } from "@/i18n/copy";

type UnitResponse = {
  unit?: { courseId?: string; classId?: string; lessonKey?: string };
  activity?: {
    id?: string;
    status?: "published" | "archived";
    title?: Record<Locale, string>;
    instructions?: Record<Locale, string>;
    rubric?: Array<{ id?: string; label?: Record<Locale, string> }>;
    checkpoint?: {
      kind?: "single-choice" | "short-answer";
      prompt?: Record<Locale, string>;
      options?: Array<{ id?: string; label?: Record<Locale, string> }>;
      explanation?: Record<Locale, string>;
    };
    dueAt?: string;
  };
  formative?: { attempted?: boolean; attemptCount?: number };
  submission?: {
    id?: string;
    state?: "draft" | "submitted" | "revision_requested" | "resubmitted" | "accepted";
    currentVersion?: {
      id?: string;
      status?: "draft" | "sealed";
      contentText?: string;
      draftRevision?: number;
    };
  };
  feedback?: Array<{
    id?: string;
    status?: "released" | "superseded";
    feedbackText?: string;
    requiresRevision?: boolean;
    releasedAt?: string;
  }>;
  completion?: { completed?: boolean; basis?: string };
  projectionVersion?: number;
  dataFreshAt?: string;
  reasonCode?: string;
};

type DraftConflict = {
  latestRevision: number;
  latestContent: string;
  localContent: string;
};

type SubmissionState = NonNullable<UnitResponse["submission"]>["state"];

type DraftRecoveryScope = {
  learnerAccount: string;
  courseId: string;
  classId: string;
  activityId: string;
};

type DraftRecoveryEnvelope = {
  version: 2;
  scope: DraftRecoveryScope;
  contentText: string;
  updatedAt: number;
};

const draftRecoveryMaxAgeMs = 7 * 24 * 60 * 60 * 1_000;

export function LearningPracticePanel({
  locale,
  courseId,
  classId,
  lessonKey,
  signInHref,
}: {
  locale: Locale;
  courseId?: string;
  classId?: string;
  lessonKey?: string;
  signInHref: string;
}) {
  const zh = locale === "zh-CN";
  const sessionUser = useSessionUser();
  const learnerAccount =
    sessionUser?.role === "student" ? sessionUser.account : undefined;
  const [unit, setUnit] = useState<UnitResponse>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [checkpointResponse, setCheckpointResponse] = useState("");
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [persistedText, setPersistedText] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "unsaved" | "saving" | "saved" | "error" | "conflict" | "recovered"
  >("idle");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<DraftConflict>();
  const [submitBusy, setSubmitBusy] = useState(false);
  const [draftRecoveryScope, setDraftRecoveryScope] =
    useState<DraftRecoveryScope>();
  const savingRef = useRef(false);
  const activityId = unit?.activity?.id;
  const storageKey = draftRecoveryScope
    ? createDraftRecoveryStorageKey(draftRecoveryScope)
    : undefined;

  const loadUnit = useCallback(async () => {
    if (!courseId || !classId || !lessonKey) return;
    setDraftRecoveryScope(undefined);
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(
        `/api/learning/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(lessonKey)}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      const body = (await response.json()) as UnitResponse;
      if (response.status === 401) {
        setSignedOut(true);
        setDraftRecoveryScope(undefined);
        return;
      }
      if (
        response.status === 404 &&
        (body.reasonCode === "published-learning-unit-required" ||
          body.reasonCode === "learning-activity-required")
      ) {
        setSignedOut(false);
        setUnit({ reasonCode: body.reasonCode });
        return;
      }
      if (!response.ok || !body.activity?.id) {
        throw new Error(body.reasonCode ?? "learning-unit-unavailable");
      }
      setSignedOut(false);
      setUnit(body);
      const serverText = body.submission?.currentVersion?.contentText ?? "";
      const serverRevision =
        body.submission?.state === "revision_requested"
          ? 0
          : body.submission?.currentVersion?.draftRevision ?? 0;
      const legacyRecoveryKey = `uais:p1:draft-recovery:${body.activity.id}`;
      window.localStorage.removeItem(legacyRecoveryKey);
      const recoveryScope = createDraftRecoveryScope({
        learnerAccount,
        courseId,
        classId,
        activityId: body.activity.id,
      });
      const recovered = recoveryScope
        ? readDraftRecovery(window.localStorage, recoveryScope)
        : undefined;
      setDraftRecoveryScope(recoveryScope);
      setDraftText(recovered && recovered !== serverText ? recovered : serverText);
      setPersistedText(serverText);
      setDraftRevision(serverRevision);
      setSaveStatus(recovered && recovered !== serverText ? "recovered" : "idle");
      setConflict(undefined);
    } catch {
      setLoadError(
        zh
          ? "暂时无法读取真实学习任务，请稍后重试。"
          : "The real learning activity is temporarily unavailable. Please retry.",
      );
    } finally {
      setLoading(false);
    }
  }, [classId, courseId, learnerAccount, lessonKey, zh]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUnit(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUnit]);

  useEffect(() => {
    if (!storageKey || !draftRecoveryScope) return;
    if (draftText === persistedText) {
      window.localStorage.removeItem(storageKey);
    } else {
      const envelope: DraftRecoveryEnvelope = {
        version: 2,
        scope: draftRecoveryScope,
        contentText: draftText,
        updatedAt: Date.now(),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(envelope));
    }
  }, [draftRecoveryScope, draftText, persistedText, storageKey]);

  const submissionState = unit?.submission?.state;
  const editable =
    unit?.activity?.status === "published" &&
    Boolean(unit?.formative?.attempted) &&
    (!submissionState || submissionState === "draft" || submissionState === "revision_requested");

  const saveDraft = useCallback(async (id: string, text: string, expectedRevision: number) => {
    savingRef.current = true;
    setSaveStatus("saving");
    setSaveError("");
    try {
      const response = await fetch(
        `/api/learning/activities/${encodeURIComponent(id)}/submission`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contentText: text,
            expectedDraftRevision: expectedRevision,
          }),
        },
      );
      const body = (await response.json()) as {
        revision?: number;
        reasonCode?: string;
        latestRevision?: number;
        latestContent?: string;
      };
      if (response.status === 401) {
        setSignedOut(true);
        throw new Error("session-required");
      }
      if (response.status === 409 && body.reasonCode === "stale-draft-revision") {
        setConflict({
          latestRevision: body.latestRevision ?? expectedRevision,
          latestContent: body.latestContent ?? "",
          localContent: text,
        });
        setSaveStatus("conflict");
        return;
      }
      if (!response.ok || typeof body.revision !== "number") {
        throw new Error(body.reasonCode ?? "draft-save-failed");
      }
      setDraftRevision(body.revision);
      setPersistedText(text);
      setSaveStatus("saved");
    } catch {
      setSaveStatus((current) => (current === "conflict" ? current : "error"));
      setSaveError(
        zh
          ? "自动保存失败；本机内容已保留，请恢复网络后重试。"
          : "Autosave failed. Your local text is retained; retry when online.",
      );
    } finally {
      savingRef.current = false;
    }
  }, [zh]);

  useEffect(() => {
    if (
      !activityId ||
      !editable ||
      !draftText.trim() ||
      draftText === persistedText ||
      conflict
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (!savingRef.current) {
        void saveDraft(activityId, draftText, draftRevision);
      }
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [activityId, conflict, draftRevision, draftText, editable, persistedText, saveDraft]);

  async function submitCheckpoint() {
    if (!activityId || !unit?.activity?.checkpoint?.kind || !checkpointResponse.trim()) {
      return;
    }
    setCheckpointBusy(true);
    setLoadError("");
    const kind = unit.activity.checkpoint.kind;
    try {
      const response = await fetch(
        `/api/learning/activities/${encodeURIComponent(activityId)}/formative-attempt`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `checkpoint-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            response:
              kind === "single-choice"
                ? { kind, optionId: checkpointResponse }
                : { kind, text: checkpointResponse },
          }),
        },
      );
      if (!response.ok) throw new Error("checkpoint-failed");
      await loadUnit();
    } catch {
      setLoadError(
        zh
          ? "形成性检查尚未保存，请重试。"
          : "The formative checkpoint was not saved. Please retry.",
      );
    } finally {
      setCheckpointBusy(false);
    }
  }

  async function submitDraft() {
    if (!activityId || draftText !== persistedText || draftRevision < 1) return;
    setSubmitBusy(true);
    setSaveError("");
    try {
      const response = await fetch(
        `/api/learning/activities/${encodeURIComponent(activityId)}/submission/submit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `submit-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ expectedDraftRevision: draftRevision }),
        },
      );
      if (!response.ok) throw new Error("submit-failed");
      if (storageKey) window.localStorage.removeItem(storageKey);
      await loadUnit();
    } catch {
      setSaveError(
        zh
          ? "提交未完成，草稿仍然保留。"
          : "Submission did not complete; your draft is still retained.",
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  if (!courseId || !classId || !lessonKey) {
    return <PracticeEmptyState locale={locale} />;
  }
  if (signedOut) {
    return (
      <div className="space-y-4 text-sm leading-6 text-[var(--muted)]">
        <p>{zh ? "登录已过期，请重新登录后继续。" : "Your session expired. Sign in to continue."}</p>
        <Link className="font-semibold text-[var(--accent)] underline" href={signInHref}>
          {zh ? "重新登录并返回本单元" : "Sign in and return to this unit"}
        </Link>
      </div>
    );
  }
  if (loading && !unit) {
    return <p className="text-sm text-[var(--muted)]">{zh ? "正在读取真实任务…" : "Loading the real activity…"}</p>;
  }
  if (loadError && !unit) {
    return (
      <div role="alert" className="space-y-3 text-sm text-[var(--muted)]">
        <p>{loadError}</p>
        <button className="font-semibold text-[var(--accent)]" onClick={() => void loadUnit()} type="button">
          {zh ? "重试" : "Retry"}
        </button>
      </div>
    );
  }
  if (!unit?.activity) return <PracticeEmptyState locale={locale} />;

  const checkpoint = unit.activity.checkpoint;
  const feedback = unit.feedback ?? [];
  return (
    <div className="space-y-5" data-uais-learning-practice="real">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
          {zh ? "真实形成性学习任务" : "Real formative learning activity"}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
          {unit.activity.title?.[locale]}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {unit.activity.instructions?.[locale]}
        </p>
      </header>

      {unit.activity.status === "archived" ? (
        <p className="rounded-xl border border-[var(--warning)] bg-[var(--surface-elevated)] p-3 text-sm leading-6 text-[var(--muted)]">
          {zh
            ? "该任务已归档；既有提交、反馈和版本历史仍可阅读，但不能再保存或提交新内容。"
            : "This activity is archived. Existing submissions, feedback, and version history remain readable, but no new content can be saved or submitted."}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <StatusChip label={zh ? "形成性检查" : "Checkpoint"} value={unit.formative?.attempted ? (zh ? "已尝试" : "Attempted") : (zh ? "未尝试" : "Not attempted")} />
        <StatusChip label={zh ? "学习产物" : "Submission"} value={formatSubmissionState(submissionState, locale)} />
        <StatusChip label={zh ? "教师反馈" : "Feedback"} value={feedback.length ? (zh ? "已发布" : "Released") : (zh ? "暂无" : "None yet")} />
        <StatusChip label={zh ? "单元完成" : "Unit completion"} value={unit.completion?.completed ? (zh ? "教师已接受" : "Teacher accepted") : (zh ? "尚未完成" : "Not complete")} />
      </div>

      {unit.activity.status === "published" && !unit.formative?.attempted && checkpoint ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
          <h3 className="font-semibold text-[var(--foreground)]">{checkpoint.prompt?.[locale]}</h3>
          {checkpoint.kind === "single-choice" ? (
            <div className="mt-3 space-y-2">
              {checkpoint.options?.map((option) => (
                <label key={option.id} className="flex items-start gap-2 text-sm text-[var(--muted)]">
                  <input type="radio" name="p1-checkpoint" value={option.id} checked={checkpointResponse === option.id} onChange={(event) => setCheckpointResponse(event.target.value)} />
                  <span>{option.label?.[locale]}</span>
                </label>
              ))}
            </div>
          ) : (
            <textarea aria-label={zh ? "形成性检查回答" : "Checkpoint response"} value={checkpointResponse} onChange={(event) => setCheckpointResponse(event.target.value)} rows={3} className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          )}
          <button type="button" disabled={checkpointBusy || !checkpointResponse.trim()} onClick={() => void submitCheckpoint()} className="mt-3 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {checkpointBusy ? (zh ? "保存中…" : "Saving…") : (zh ? "提交检查" : "Submit checkpoint")}
          </button>
        </section>
      ) : null}

      {unit.formative?.attempted && checkpoint?.explanation?.[locale] ? (
        <p className="rounded-xl bg-[var(--accent-soft)] p-3 text-sm leading-6 text-[var(--muted)]">
          {checkpoint.explanation[locale]}
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-[var(--foreground)]">{zh ? "结构化文本产物" : "Structured text evidence"}</h3>
          <span aria-live="polite" className="text-xs font-medium text-[var(--muted)]">{formatSaveStatus(saveStatus, locale)}</span>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--muted)]">
          {unit.activity.rubric?.map((item) => <li key={item.id}>{item.label?.[locale]}</li>)}
        </ul>
        <textarea aria-label={zh ? "学习产物正文" : "Learning evidence text"} value={draftText} readOnly={!editable} disabled={!unit.formative?.attempted} maxLength={20_000} rows={10} onChange={(event) => { setDraftText(event.target.value); setSaveStatus("unsaved"); setSaveError(""); }} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-60" />
        <p className="text-xs text-[var(--muted)]">{zh ? `${Array.from(draftText).length}/20,000 字符；支持纯文本与受限 Markdown。` : `${Array.from(draftText).length}/20,000 characters; plain text and restricted Markdown only.`}</p>
        {saveError ? <p role="alert" className="text-sm text-[var(--danger)]">{saveError}</p> : null}
        {conflict ? <DraftConflictPanel conflict={conflict} locale={locale} onUseServer={() => { setDraftText(conflict.latestContent); setPersistedText(conflict.latestContent); setDraftRevision(conflict.latestRevision); setConflict(undefined); setSaveStatus("saved"); }} onMerge={() => { setDraftText(`${conflict.latestContent}\n\n---\n\n${conflict.localContent}`); setPersistedText(conflict.latestContent); setDraftRevision(conflict.latestRevision); setConflict(undefined); setSaveStatus("unsaved"); }} /> : null}
        {editable ? (
          <button type="button" disabled={submitBusy || !draftText.trim() || draftText !== persistedText || draftRevision < 1 || Boolean(conflict)} onClick={() => void submitDraft()} className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submitBusy ? (zh ? "提交中…" : "Submitting…") : submissionState === "revision_requested" ? (zh ? "提交新版本" : "Submit new version") : (zh ? "封存并提交" : "Seal and submit")}
          </button>
        ) : null}
      </section>

      {feedback.length ? (
        <section className="space-y-3 border-t border-[var(--border)] pt-4">
          <h3 className="font-semibold text-[var(--foreground)]">{zh ? "教师已发布反馈" : "Released teacher feedback"}</h3>
          {feedback.map((item) => <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-sm leading-6 text-[var(--muted)]"><p className="whitespace-pre-wrap">{item.feedbackText}</p></article>)}
        </section>
      ) : null}
    </div>
  );
}

function createDraftRecoveryScope(input: {
  learnerAccount?: string;
  courseId?: string;
  classId?: string;
  activityId?: string;
}): DraftRecoveryScope | undefined {
  if (
    !input.learnerAccount ||
    !input.courseId ||
    !input.classId ||
    !input.activityId
  ) {
    return undefined;
  }
  return {
    learnerAccount: input.learnerAccount,
    courseId: input.courseId,
    classId: input.classId,
    activityId: input.activityId,
  };
}

function createDraftRecoveryStorageKey(scope: DraftRecoveryScope) {
  return [
    "uais:p1:draft-recovery:v2",
    scope.learnerAccount,
    scope.courseId,
    scope.classId,
    scope.activityId,
  ]
    .map((value, index) => (index === 0 ? value : encodeURIComponent(value)))
    .join(":");
}

function readDraftRecovery(
  storage: Storage,
  expectedScope: DraftRecoveryScope,
): string | undefined {
  const storageKey = createDraftRecoveryStorageKey(expectedScope);
  const serialized = storage.getItem(storageKey);
  if (!serialized) return undefined;
  try {
    const envelope = JSON.parse(serialized) as Partial<DraftRecoveryEnvelope>;
    if (
      envelope.version !== 2 ||
      typeof envelope.contentText !== "string" ||
      typeof envelope.updatedAt !== "number" ||
      Date.now() - envelope.updatedAt > draftRecoveryMaxAgeMs ||
      !sameDraftRecoveryScope(envelope.scope, expectedScope)
    ) {
      storage.removeItem(storageKey);
      return undefined;
    }
    return envelope.contentText;
  } catch {
    storage.removeItem(storageKey);
    return undefined;
  }
}

function sameDraftRecoveryScope(
  actual: Partial<DraftRecoveryScope> | undefined,
  expected: DraftRecoveryScope,
) {
  return (
    actual?.learnerAccount === expected.learnerAccount &&
    actual.courseId === expected.courseId &&
    actual.classId === expected.classId &&
    actual.activityId === expected.activityId
  );
}

function PracticeEmptyState({ locale }: { locale: Locale }) {
  return <p className="px-2 py-6 text-center text-sm leading-6 text-[var(--muted)]">{locale === "zh-CN" ? "当前真实课件单元尚未发布学习任务；这里不会显示虚构待交作业。" : "No activity is published for this real lesson yet. This view does not invent pending work."}</p>;
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2"><p className="text-[var(--muted)]">{label}</p><p className="mt-1 font-semibold text-[var(--foreground)]">{value}</p></div>;
}

function DraftConflictPanel({ conflict, locale, onUseServer, onMerge }: { conflict: DraftConflict; locale: Locale; onUseServer: () => void; onMerge: () => void }) {
  const zh = locale === "zh-CN";
  return <div role="alert" className="rounded-xl border border-[var(--danger)] p-3 text-sm"><p className="font-semibold text-[var(--danger)]">{zh ? "检测到另一设备上的较新草稿；本机文字未被覆盖。" : "A newer server draft exists; your local text was not overwritten."}</p><div className="mt-3 grid gap-2"><pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-elevated)] p-2 text-xs">{conflict.latestContent}</pre><div className="flex flex-wrap gap-2"><button type="button" onClick={onUseServer} className="rounded-full border border-[var(--border)] px-3 py-1.5 font-semibold">{zh ? "使用服务端版本" : "Use server version"}</button><button type="button" onClick={onMerge} className="rounded-full bg-[var(--accent)] px-3 py-1.5 font-semibold text-white">{zh ? "显式合并两份文字" : "Explicitly merge both"}</button><button type="button" onClick={() => void navigator.clipboard?.writeText(conflict.localContent)} className="rounded-full border border-[var(--border)] px-3 py-1.5 font-semibold">{zh ? "复制本机文字" : "Copy local text"}</button></div></div></div>;
}

function formatSubmissionState(state: SubmissionState, locale: Locale) {
  const labels: Record<string, [string, string]> = { draft: ["草稿中", "Draft"], submitted: ["等待教师反馈", "Awaiting review"], revision_requested: ["需要修订", "Revision required"], resubmitted: ["已重新提交", "Resubmitted"], accepted: ["教师已接受", "Accepted"] };
  const label = state ? labels[String(state)] : undefined;
  return label?.[locale === "zh-CN" ? 0 : 1] ?? (locale === "zh-CN" ? "未开始" : "Not started");
}

function formatSaveStatus(status: string, locale: Locale) {
  const labels: Record<string, [string, string]> = { idle: ["", ""], unsaved: ["等待自动保存", "Waiting to autosave"], saving: ["正在保存…", "Saving…"], saved: ["已由服务端保存", "Saved by server"], error: ["保存失败，本机已保留", "Save failed; retained locally"], conflict: ["需要处理版本冲突", "Version conflict needs attention"], recovered: ["已恢复本机未提交文字", "Recovered local unsaved text"] };
  return labels[status]?.[locale === "zh-CN" ? 0 : 1] ?? "";
}
