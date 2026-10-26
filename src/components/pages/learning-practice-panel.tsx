"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionUser } from "@/components/providers/session-user";
import type { Locale } from "@/i18n/copy";
import { availableLocalStorage, readSealIntent, writeSealIntent, removeSealIntent, type SubmissionSealIntent } from "@/lib/learning-loop/client-submission-recovery";
import type { SubmissionImage } from "@/lib/learning-loop/submission-image-policy";
import { SubmissionImageEditor, type SubmissionImageSnapshot } from "./submission-image-editor";

type UnitResponse = {
  unit?: { courseId?: string; classId?: string; lessonKey?: string; recordsReadOnly?: boolean };
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
      attachments?: SubmissionImage[];
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
  versionChanged?: boolean;
};

type SubmissionState = NonNullable<UnitResponse["submission"]>["state"];

type DraftRecoveryScope = {
  learnerAccount: string;
  courseId: string;
  classId: string;
  activityId: string;
};

type DraftRecoveryEnvelope = {
  version: 2 | 3;
  scope: DraftRecoveryScope;
  contentText: string;
  updatedAt: number;
  base?: DraftRecoveryBase;
};

type DraftRecoveryBase = {
  submissionVersionId?: string | null;
  draftRevision?: number;
};

type DraftRecoverySnapshot = { storageKey: string; serialized: string };

const draftRecoveryMaxAgeMs = 7 * 24 * 60 * 60 * 1_000;

type LearningPracticePanelProps = {
  locale: Locale;
  courseId?: string;
  classId?: string;
  lessonKey?: string;
  requestedActivityId?: string;
  signInHref: string;
};

export function LearningPracticePanel(props: LearningPracticePanelProps) {
  const sessionUser = useSessionUser();
  // A new scope owns a new editor; late requests and unsaved text stay with the
  // activity that started them. Recovery storage remains scoped by actual ID.
  const scopeKey = JSON.stringify([
    sessionUser?.account, sessionUser?.role, props.courseId, props.classId,
    props.lessonKey, props.requestedActivityId,
  ]);
  return <LearningPracticeEditor key={scopeKey} {...props} />;
}

function LearningPracticeEditor({
  locale,
  courseId,
  classId,
  lessonKey,
  requestedActivityId,
  signInHref,
}: LearningPracticePanelProps) {
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
  const [submissionVersionId, setSubmissionVersionId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "unsaved" | "saving" | "saved" | "error" | "conflict" | "recovered"
  >("idle");
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState<DraftConflict>();
  const [submitBusy, setSubmitBusy] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [sealIntent, setSealIntent] = useState<SubmissionSealIntent>();
  const sealIntentRef = useRef<SubmissionSealIntent | undefined>(undefined);
  const [attachments, setAttachments] = useState<SubmissionImage[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const imageBusyRef = useRef(false);
  const [pendingImageCount, setPendingImageCount] = useState(0);
  const pendingImageCountRef = useRef(0);
  const [imageRecoveryReady, setImageRecoveryReady] = useState(() => typeof indexedDB === "undefined");
  const versionRef = useRef<{id:string|null;revision:number}>({id:null,revision:0});
  const draftTextRef = useRef("");
  const persistedTextRef = useRef("");
  const [draftRecoveryScope, setDraftRecoveryScope] =
    useState<DraftRecoveryScope>();
  const [draftRecoveryBase, setDraftRecoveryBase] = useState<DraftRecoveryBase>({});
  const savingRef = useRef(false);
  const draftRecoverySnapshotRef = useRef<DraftRecoverySnapshot | undefined>(undefined);
  const activityId = unit?.activity?.id;
  const storageKey = draftRecoveryScope
    ? createDraftRecoveryStorageKey(draftRecoveryScope)
    : undefined;

  const loadUnit = useCallback(async (useServerText = false) => {
    if (!courseId || !classId || !lessonKey) return;
    setDraftRecoveryScope(undefined);
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(
        `/api/learning/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(lessonKey)}?${new URLSearchParams({classId,...(requestedActivityId?{activityId:requestedActivityId}:{})})}`,
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
      if (!response.ok || !body.activity?.id || (requestedActivityId && body.activity.id.toLowerCase() !== requestedActivityId.trim().toLowerCase())) {
        throw new Error(body.reasonCode ?? "learning-unit-unavailable");
      }
      setSignedOut(false);
      setUnit(body);
      const serverText = body.submission?.currentVersion?.contentText ?? "";
      const serverRevision =
        body.submission?.state === "revision_requested"
          ? 0
          : body.submission?.currentVersion?.draftRevision ?? 0;
      const storage = availableLocalStorage();
      if (!storage) setStorageUnavailable(true);
      try { storage?.removeItem(`uais:p1:draft-recovery:${body.activity.id}`); } catch { setStorageUnavailable(true); }
      const recoveryScope = createDraftRecoveryScope({
        learnerAccount,
        courseId,
        classId,
        activityId: body.activity.id,
      });
      const canRecoverDraft = body.activity.status === "published" &&
        (!body.submission?.state || body.submission.state === "draft" || body.submission.state === "revision_requested");
      // A local draft is not the evidence that was sealed or accepted elsewhere.
      let recovered: ReturnType<typeof readDraftRecovery>;
      try { recovered = storage && recoveryScope && canRecoverDraft && !useServerText ? readDraftRecovery(storage, recoveryScope) : undefined; }
      catch { setStorageUnavailable(true); }
      if (recovered && recoveryScope) {
        draftRecoverySnapshotRef.current = {
          storageKey: createDraftRecoveryStorageKey(recoveryScope),
          serialized: recovered.serialized,
        };
      }
      const serverVersionId = body.submission?.currentVersion?.id ?? null;
      versionRef.current={id:serverVersionId,revision:serverRevision};
      setAttachments(body.submission?.currentVersion?.attachments??[]);
      const pendingSeal = recoveryScope ? readSealIntent(storage, recoveryScope) : undefined;
      if (pendingSeal && serverVersionId === pendingSeal.submissionVersionId && body.submission?.currentVersion?.status === "sealed") {
        if (!removeSealIntent(storage, pendingSeal)) setStorageUnavailable(true);
        sealIntentRef.current = undefined; setSealIntent(undefined);
      } else if (pendingSeal) { sealIntentRef.current = pendingSeal; setSealIntent(pendingSeal); }
      const hasRecoveredText = Boolean(recovered && recovered.contentText !== serverText);
      const sameRecoveryVersion = recovered?.base.submissionVersionId === serverVersionId;
      const recoveryConflict = hasRecoveredText &&
        (!sameRecoveryVersion || recovered?.base.draftRevision !== serverRevision);
      setDraftRecoveryScope(canRecoverDraft ? recoveryScope : undefined);
      setDraftRecoveryBase(hasRecoveredText && recovered ? recovered.base : { submissionVersionId: serverVersionId, draftRevision: serverRevision });
      setDraftText(hasRecoveredText && recovered ? recovered.contentText : serverText);
      draftTextRef.current=hasRecoveredText&&recovered?recovered.contentText:serverText;
      setPersistedText(serverText);
      persistedTextRef.current=serverText;
      setDraftRevision(serverRevision);
      setSubmissionVersionId(serverVersionId);
      setSaveStatus(recoveryConflict ? "conflict" : hasRecoveredText ? "recovered" : "idle");
      setConflict(recoveryConflict ? { latestRevision: serverRevision, latestContent: serverText, versionChanged: !sameRecoveryVersion } : undefined);
      return body;
    } catch {
      setLoadError(
        zh
          ? "暂时无法读取学习任务，请稍后重试。"
          : "The learning activity is temporarily unavailable. Please retry.",
      );
    } finally {
      setLoading(false);
    }
  }, [classId, courseId, learnerAccount, lessonKey, requestedActivityId, zh]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUnit(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUnit]);

  useEffect(() => {
    if (!storageKey || !draftRecoveryScope) return;
    const storage=availableLocalStorage();
    if(!storage){queueMicrotask(()=>setStorageUnavailable(true));return;}
    try {
    if (draftText === persistedText) {
      removeUnchangedDraftRecovery(storage, storageKey, draftRecoverySnapshotRef.current);
    } else {
      const envelope: DraftRecoveryEnvelope = {
        version: 3,
        scope: draftRecoveryScope,
        contentText: draftText,
        updatedAt: Date.now(),
        base: draftRecoveryBase,
      };
      const serialized = JSON.stringify(envelope);
      storage.setItem(storageKey, serialized);
      draftRecoverySnapshotRef.current = { storageKey, serialized };
    }
    } catch { queueMicrotask(()=>setStorageUnavailable(true)); }
  }, [draftRecoveryBase, draftRecoveryScope, draftText, persistedText, storageKey]);

  const submissionState = unit?.submission?.state;
  const editable =
    unit?.activity?.status === "published" &&
    !unit?.unit?.recordsReadOnly &&
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
            expectedSubmissionVersionId: versionRef.current.id,
          }),
        },
      );
      const body = (await response.json()) as {
        revision?: number;
        reasonCode?: string;
        latestRevision?: number;
        latestContent?: string;
        submissionVersionId?: string;
      };
      if (response.status === 401) {
        setSignedOut(true);
        throw new Error("session-required");
      }
      if (response.status === 409 && (body.reasonCode === "stale-draft-revision" || body.reasonCode === "stale-submission-version")) {
        setConflict({
          latestRevision: body.latestRevision ?? expectedRevision,
          latestContent: body.latestContent ?? "",
          versionChanged: body.reasonCode === "stale-submission-version",
        });
        setSaveStatus("conflict");
        return;
      }
      if (!response.ok || typeof body.revision !== "number" || !body.submissionVersionId) {
        throw new Error(body.reasonCode ?? "draft-save-failed");
      }
      setDraftRevision(body.revision);
      setSubmissionVersionId(body.submissionVersionId);
      versionRef.current={id:body.submissionVersionId,revision:body.revision};
      setDraftRecoveryBase({ submissionVersionId: body.submissionVersionId, draftRevision: body.revision });
      setPersistedText(text);
      persistedTextRef.current=text;
      setSaveStatus("saved");
      return {submissionVersionId:body.submissionVersionId,revision:body.revision};
    } catch (caught) {
      setSaveStatus((current) => (current === "conflict" ? current : "error"));
      const closed = caught instanceof Error && (caught.message === "course-records-closed" || caught.message === "course-records-purged");
      if(closed)setUnit((current)=>current?{...current,unit:{...current.unit,recordsReadOnly:true}}:current);
      setSaveError(
        closed ? (zh ? "课程已结束，学习记录仍可回看。" : "This course has ended. Learning records remain available to read.") : zh
          ? "自动保存失败；当前页面的文字仍在，请恢复网络后重试。"
          : "Autosave failed. Your text is still on this page; retry when online.",
      );
    } finally {
      savingRef.current = false;
    }
  }, [zh]);

  useEffect(() => {
    if (
      !activityId ||
      !editable ||
      draftText === persistedText ||
      conflict || sealIntent || imageBusy
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (!savingRef.current && !imageBusyRef.current && !sealIntentRef.current) {
        void saveDraft(activityId, draftText, draftRevision);
      }
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [activityId, conflict, draftRevision, draftText, editable, persistedText, saveDraft, sealIntent, imageBusy]);

  async function readImageSnapshot():Promise<SubmissionImageSnapshot> {
    if(!courseId||!classId||!lessonKey||!activityId)throw Error("student-scope-required");
    const response=await fetch(`/api/learning/courses/${encodeURIComponent(courseId)}/units/${encodeURIComponent(lessonKey)}?${new URLSearchParams({classId,activityId})}`,{cache:"no-store",headers:{accept:"application/json"}});
    const body=await response.json() as UnitResponse;
    if(response.status===401){setSignedOut(true);throw Error("session-required");}
    if(!response.ok||body.activity?.id!==activityId)throw Error("submission-readback-required");
    if(body.unit?.recordsReadOnly){setUnit(body);throw Error("course-records-closed");}
    const current=body.submission?.currentVersion;
    return {submissionVersionId:current?.id??null,draftRevision:current?.draftRevision??0,attachments:current?.attachments??[],contentText:current?.contentText??"",sealed:current?.status==="sealed"};
  }
  function imageConflict(current:SubmissionImageSnapshot){setConflict({latestRevision:current.draftRevision,latestContent:current.contentText,versionChanged:current.submissionVersionId!==versionRef.current.id||current.sealed});setSaveStatus("conflict");}
  function updateImageSnapshot(current:SubmissionImageSnapshot){
    setAttachments(current.attachments);
    if(current.contentText!==persistedTextRef.current){imageConflict(current);return;}
    versionRef.current={id:current.submissionVersionId,revision:current.draftRevision};setSubmissionVersionId(current.submissionVersionId);setDraftRevision(current.draftRevision);setDraftRecoveryBase({submissionVersionId:current.submissionVersionId,draftRevision:current.draftRevision});
    if(current.sealed)void loadUnit();
  }
  async function prepareImageDraft():Promise<SubmissionImageSnapshot|undefined>{
    if(!activityId||!editable||savingRef.current||sealIntentRef.current||conflict)return;
    const previous=versionRef.current;
    if(!previous.id||previous.revision<1||draftTextRef.current!==persistedTextRef.current ){
      const saved=await saveDraft(activityId,draftTextRef.current,previous.revision);if(!saved)return;
    }
    const current=await readImageSnapshot();
    if(current.submissionVersionId!==versionRef.current.id||current.draftRevision!==versionRef.current.revision||current.contentText!==persistedTextRef.current||current.sealed){imageConflict(current);return;}
    updateImageSnapshot(current);return current;
  }

  async function submitCheckpoint() {
    if (!activityId || unit?.unit?.recordsReadOnly || !unit?.activity?.checkpoint?.kind || !checkpointResponse.trim()) {
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
    if (!activityId || !imageRecoveryReady || unit?.unit?.recordsReadOnly || !submissionVersionId || draftText !== persistedText || draftRevision < 1 || imageBusyRef.current || pendingImageCountRef.current || savingRef.current || (!draftText.trim() && attachments.length === 0)) return;
    const submittedRecovery = draftRecoverySnapshotRef.current;
    setSubmitBusy(true);
    setSaveError("");
    try {
      let intent=sealIntentRef.current;
      if (intent) {
        const current=await loadUnit();
        if (!current?.submission?.currentVersion) throw new Error("submit-readback-required");
        const version=current.submission.currentVersion;
        if (version.id===intent.submissionVersionId&&version.status==="sealed") { removeSealIntent(availableLocalStorage(),intent);sealIntentRef.current=undefined;setSealIntent(undefined);return; }
        if (version.id!==intent.submissionVersionId||version.draftRevision!==intent.draftRevision) {
          setConflict({latestRevision:version.draftRevision??0,latestContent:version.contentText??"",versionChanged:version.id!==intent.submissionVersionId});
          setSaveStatus("conflict"); removeSealIntent(availableLocalStorage(),intent);sealIntentRef.current=undefined;setSealIntent(undefined);return;
        }
      } else {
        const scope=createDraftRecoveryScope({learnerAccount,courseId,classId,activityId});
        if(!scope)throw Error("student-scope-required");
        intent={scope,submissionVersionId,draftRevision,idempotencyKey:`submit-${crypto.randomUUID()}`,updatedAt:Date.now()};
        sealIntentRef.current=intent;setSealIntent(intent);
        if(!writeSealIntent(availableLocalStorage(),intent))setStorageUnavailable(true);
      }
      const response = await fetch(
        `/api/learning/activities/${encodeURIComponent(activityId)}/submission/submit`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": intent.idempotencyKey,
          },
          body: JSON.stringify({ expectedDraftRevision: intent.draftRevision, expectedSubmissionVersionId: intent.submissionVersionId }),
        },
      );
      if (!response.ok) {
        if(response.status===401){setSignedOut(true);throw Error("session-required");}
        const body = await response.json() as { reasonCode?: string; latestRevision?: number; latestContent?: string };
        if(body.reasonCode==="course-records-closed"||body.reasonCode==="course-records-purged"){
          setUnit((current)=>current?{...current,unit:{...current.unit,recordsReadOnly:true}}:current);
          removeSealIntent(availableLocalStorage(),intent);sealIntentRef.current=undefined;setSealIntent(undefined);return;
        }
        if (response.status === 409 && (body.reasonCode === "stale-submission-version" || body.reasonCode === "stale-draft-revision")) {
          setConflict({ latestRevision: body.latestRevision ?? 0, latestContent: body.latestContent ?? "", versionChanged: body.reasonCode === "stale-submission-version" });
          setSaveStatus("conflict");
          removeSealIntent(availableLocalStorage(),intent);sealIntentRef.current=undefined;setSealIntent(undefined);
          return;
        }
        throw new Error("submit-failed");
      }
      if(!removeSealIntent(availableLocalStorage(),intent))setStorageUnavailable(true);
      sealIntentRef.current=undefined;setSealIntent(undefined);
      try { const storage=availableLocalStorage(); if(storage)removeUnchangedDraftRecovery(storage,storageKey,submittedRecovery); } catch { setStorageUnavailable(true); }
      await loadUnit();
    } catch {
      setSaveError(
        zh
          ? "提交结果尚未确认。请核对服务端状态后重试，避免重复提交。"
          : "The submission result is not confirmed. Check the server state before retrying.",
      );
    } finally {
      setSubmitBusy(false);
    }
  }

  function resolveDraftConflict(merge: boolean) {
    if (!conflict) return;
    if (conflict.versionChanged) {
      void loadUnit(true);
      return;
    }
    setDraftText(merge ? `${conflict.latestContent}\n\n---\n\n${draftText}` : conflict.latestContent);
    draftTextRef.current=merge?`${conflict.latestContent}\n\n---\n\n${draftText}`:conflict.latestContent;
    setPersistedText(conflict.latestContent);
    persistedTextRef.current=conflict.latestContent;
    setDraftRevision(conflict.latestRevision);
    versionRef.current={id:submissionVersionId,revision:conflict.latestRevision};
    setDraftRecoveryBase({ submissionVersionId, draftRevision: conflict.latestRevision });
    setConflict(undefined);
    setSaveStatus(merge ? "unsaved" : "saved");
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
    return <p className="text-sm text-[var(--muted)]">{zh ? "正在读取学习任务…" : "Loading the activity…"}</p>;
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
          {zh ? "课堂学习任务" : "Classroom learning activity"}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
          {unit.activity.title?.[locale]}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {unit.activity.instructions?.[locale]}
        </p>
      </header>

      {loadError ? <p role="alert" className="text-sm text-[var(--danger)]">{loadError}</p> : null}
      {unit.unit?.recordsReadOnly ? <p role="status" className="rounded-xl border border-[var(--border)] p-3 text-sm">{zh?"课程已结束，学习记录仍可回看。":"This course has ended. Learning records remain available to read."}</p>:null}
      {storageUnavailable ? <p role="status" className="rounded-xl border border-[var(--warning)] p-3 text-sm">{zh?"本机恢复副本不可用。尚未保存到服务器的文字只在当前页面，请勿刷新或关闭，并先复制备份。":"Local recovery storage is unavailable. Unsaved text exists only on this page; copy it before refreshing or closing."}</p>:null}

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

      {unit.activity.status === "published" && !unit.unit?.recordsReadOnly && !unit.formative?.attempted && checkpoint ? (
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
        <textarea aria-label={zh ? "学习产物正文" : "Learning evidence text"} value={draftText} readOnly={!editable || submitBusy || imageBusy || Boolean(sealIntent)} disabled={!unit.formative?.attempted} maxLength={20_000} rows={10} onChange={(event) => { draftTextRef.current=event.target.value; setDraftText(event.target.value); setSaveStatus("unsaved"); setSaveError(""); }} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-60" />
        <p className="text-xs text-[var(--muted)]">{zh ? `${Array.from(draftText).length}/20,000 字符；支持纯文本与受限 Markdown。` : `${Array.from(draftText).length}/20,000 characters; plain text and restricted Markdown only.`}</p>
        {saveError ? <p role="alert" className="text-sm text-[var(--danger)]">{saveError}</p> : null}
        {editable && saveStatus === "error" && !conflict ? (
          <button type="button" disabled={imageBusy || submitBusy} onClick={() => {
            if (activityId && !savingRef.current) void saveDraft(activityId, draftText, draftRevision);
          }} className="rounded-full border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-50">
            {zh ? "重试保存" : "Retry save"}
          </button>
        ) : null}
        {conflict ? <DraftConflictPanel conflict={conflict} localContent={draftText} locale={locale} onUseServer={() => resolveDraftConflict(false)} onMerge={conflict.versionChanged ? undefined : () => resolveDraftConflict(true)} /> : null}
        {editable ? (
          <button type="button" disabled={submitBusy || !imageRecoveryReady || imageBusy || pendingImageCount > 0 || (!draftText.trim() && attachments.length === 0) || draftText !== persistedText || draftRevision < 1 || Boolean(conflict)} onClick={() => void submitDraft()} className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {submitBusy ? (zh ? "提交中…" : "Submitting…") : sealIntent ? (zh ? "核对并重试提交" : "Check and retry submission") : submissionState === "revision_requested" ? (zh ? "提交新版本" : "Submit new version") : (zh ? "封存并提交" : "Seal and submit")}
          </button>
        ) : null}
      </section>

      {activityId && learnerAccount && courseId && classId ? <SubmissionImageEditor scope={{learnerAccount,courseId,classId,activityId}} locale={locale} versionId={submissionVersionId} revision={draftRevision} attachments={attachments} editable={editable} disabled={submitBusy || !imageRecoveryReady || imageBusy || saveStatus === "saving" || Boolean(conflict) || Boolean(sealIntent)} prepareDraft={prepareImageDraft} readSnapshot={readImageSnapshot} onUpdated={updateImageSnapshot} onConflict={imageConflict} onAuthenticationRequired={()=>setSignedOut(true)} onBusyChange={(value)=>{imageBusyRef.current=value;setImageBusy(value);}} onPendingChange={(count)=>{pendingImageCountRef.current=count;setPendingImageCount(count);}} onRecoveryReady={()=>setImageRecoveryReady(true)} /> : null}

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
): { contentText: string; base: DraftRecoveryBase; serialized: string } | undefined {
  const storageKey = createDraftRecoveryStorageKey(expectedScope);
  const serialized = storage.getItem(storageKey);
  if (!serialized) return undefined;
  try {
    const envelope = JSON.parse(serialized) as Partial<DraftRecoveryEnvelope>;
    if (
      (envelope.version !== 2 && envelope.version !== 3) ||
      typeof envelope.contentText !== "string" ||
      typeof envelope.updatedAt !== "number" ||
      Date.now() - envelope.updatedAt > draftRecoveryMaxAgeMs ||
      !sameDraftRecoveryScope(envelope.scope, expectedScope)
    ) {
      storage.removeItem(storageKey);
      return undefined;
    }
    const candidate = envelope.version === 3 ? envelope.base : undefined;
    // Keep unknown legacy bases recoverable, but never authorize autosave from them.
    const base: DraftRecoveryBase = candidate &&
      (candidate.submissionVersionId === null || typeof candidate.submissionVersionId === "string") &&
      Number.isInteger(candidate.draftRevision) && (candidate.draftRevision ?? -1) >= 0
      ? candidate
      : {};
    return { contentText: envelope.contentText, base, serialized };
  } catch {
    storage.removeItem(storageKey);
    return undefined;
  }
}

function removeUnchangedDraftRecovery(storage: Storage, storageKey: string | undefined, snapshot?: DraftRecoverySnapshot) {
  // A delayed save or submit only owns the recovery copy this editor saw or
  // wrote. Another open tab may already have stored newer unsaved work.
  if (snapshot && snapshot.storageKey === storageKey && storage.getItem(storageKey) === snapshot.serialized) {
    storage.removeItem(snapshot.storageKey);
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
  return <p className="px-2 py-6 text-center text-sm leading-6 text-[var(--muted)]">{locale === "zh-CN" ? "教师尚未为此课时发布学习任务。" : "Your teacher has not published an activity for this lesson yet."}</p>;
}

function StatusChip({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2"><p className="text-[var(--muted)]">{label}</p><p className="mt-1 font-semibold text-[var(--foreground)]">{value}</p></div>;
}

function DraftConflictPanel({ conflict, localContent, locale, onUseServer, onMerge }: { conflict: DraftConflict; localContent: string; locale: Locale; onUseServer: () => void; onMerge?: () => void }) {
  const zh = locale === "zh-CN";
  return <div role="alert" className="rounded-xl border border-[var(--danger)] p-3 text-sm"><p className="font-semibold text-[var(--danger)]">{conflict.versionChanged ? (zh ? "提交版本已在另一设备上改变；本机文字已保留。请复制后重新读取服务端版本。" : "The submission version changed elsewhere. Your local text is retained; copy it before loading the server version.") : (zh ? "检测到另一设备上的较新草稿；本机文字未被覆盖。" : "A newer server draft exists; your local text was not overwritten.")}</p><div className="mt-3 grid gap-2"><pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-elevated)] p-2 text-xs">{conflict.latestContent}</pre><div className="flex flex-wrap gap-2"><button type="button" onClick={onUseServer} className="rounded-full border border-[var(--border)] px-3 py-1.5 font-semibold">{zh ? "使用服务端版本" : "Use server version"}</button>{onMerge ? <button type="button" onClick={onMerge} className="rounded-full bg-[var(--accent)] px-3 py-1.5 font-semibold text-white">{zh ? "显式合并两份文字" : "Explicitly merge both"}</button> : null}<button type="button" onClick={() => void navigator.clipboard?.writeText(localContent)} className="rounded-full border border-[var(--border)] px-3 py-1.5 font-semibold">{zh ? "复制本机文字" : "Copy local text"}</button></div></div></div>;
}

function formatSubmissionState(state: SubmissionState, locale: Locale) {
  const labels: Record<string, [string, string]> = { draft: ["草稿中", "Draft"], submitted: ["等待教师反馈", "Awaiting review"], revision_requested: ["需要修订", "Revision required"], resubmitted: ["已重新提交", "Resubmitted"], accepted: ["教师已接受", "Accepted"] };
  const label = state ? labels[String(state)] : undefined;
  return label?.[locale === "zh-CN" ? 0 : 1] ?? (locale === "zh-CN" ? "未开始" : "Not started");
}

function formatSaveStatus(status: string, locale: Locale) {
  const labels: Record<string, [string, string]> = { idle: ["", ""], unsaved: ["等待自动保存", "Waiting to autosave"], saving: ["正在保存…", "Saving…"], saved: ["已由服务端保存", "Saved by server"], error: ["保存失败", "Save failed"], conflict: ["需要处理版本冲突", "Version conflict needs attention"], recovered: ["已恢复本机未提交文字", "Recovered local unsaved text"] };
  return labels[status]?.[locale === "zh-CN" ? 0 : 1] ?? "";
}
