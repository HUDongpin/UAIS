"use client";

import { useEffect, useRef, useState } from "react";
import { FloppyDisk } from "@phosphor-icons/react/dist/ssr/FloppyDisk";
import { copy, type Locale } from "@/i18n/copy";
import { isTeachingUnitDraftContent, type TeachingUnitDraftContent } from "@/lib/teaching/unit-draft";

export type VerifiedTeachingUnitDraft = {
  courseId: string;
  unitDraftId: string;
  operationRecordId: string;
  draftStatus: "generated";
  content: TeachingUnitDraftContent;
  revision: number;
};

function parseUnitDraft(value: unknown, courseId: string, operationRecordId?: string): VerifiedTeachingUnitDraft {
  const draft = value as Partial<VerifiedTeachingUnitDraft> | undefined;
  if (!draft || draft.courseId !== courseId ||
    (operationRecordId !== undefined && draft.operationRecordId !== operationRecordId) ||
    typeof draft.operationRecordId !== "string" || !draft.operationRecordId ||
    typeof draft.unitDraftId !== "string" || !draft.unitDraftId ||
    draft.draftStatus !== "generated" || !isTeachingUnitDraftContent(draft.content) ||
    !Number.isInteger(draft.revision) || (draft.revision ?? 0) < 1) {
    throw new Error("unit-draft-incomplete");
  }
  return draft as VerifiedTeachingUnitDraft;
}

export async function readVerifiedTeachingUnitDraft(courseId: string, operationRecordId?: string, signal?: AbortSignal) {
  const response = await fetch(`/api/teaching/courses/${encodeURIComponent(courseId)}/unit-draft`, {
    method: "GET", headers: { accept: "application/json" }, cache: "no-store", signal,
  });
  if (!response.ok) throw new Error(response.status === 404 ? "unit-draft-missing" : "unit-draft-read-failed");
  const payload = await response.json();
  return parseUnitDraft(payload.unitDraft, courseId, operationRecordId);
}

type Props = { courseId: string; locale: Locale; expectedOperationRecordId?: string; generationPending?: boolean };

export function TeachingUnitDraftEditor(props: Props) {
  return <UnitDraftEditor key={`${props.courseId}:${props.expectedOperationRecordId ?? "current"}`} {...props} />;
}

function UnitDraftEditor({ courseId, locale, expectedOperationRecordId, generationPending }: Props) {
  const t = copy[locale].teachingUnitDraft;
  const [draft, setDraft] = useState<VerifiedTeachingUnitDraft>();
  const [content, setContent] = useState<TeachingUnitDraftContent>();
  const [status, setStatus] = useState<"loading" | "ready" | "dirty" | "missing" | "incomplete" | "error" | "saving" | "saved" | "conflict">("loading");
  const mounted = useRef(false);
  const savePending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void readVerifiedTeachingUnitDraft(courseId, expectedOperationRecordId, controller.signal).then((readback) => {
      if (controller.signal.aborted) return;
      setDraft(readback);
      setContent(readback.content);
      setStatus("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStatus(error instanceof Error && error.message === "unit-draft-missing" ? "missing" : error instanceof Error && error.message === "unit-draft-incomplete" ? "incomplete" : "error");
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [courseId, expectedOperationRecordId]);

  function editContent(nextContent: TeachingUnitDraftContent) {
    setContent(nextContent);
    setStatus((current) => current === "saved" || current === "ready" ? "dirty" : current);
  }

  async function save() {
    if (!draft || !content || !isTeachingUnitDraftContent(content) || savePending.current || generationPending) return;
    savePending.current = true;
    setStatus("saving");
    try {
      const response = await fetch(`/api/teaching/courses/${encodeURIComponent(courseId)}/unit-draft`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, expectedRevision: draft.revision }),
      });
      if (!mounted.current) return;
      if (response.status === 409) { setStatus("conflict"); return; }
      if (!response.ok) throw new Error("unit-draft-save-failed");
      const payload = await response.json();
      if (!mounted.current) return;
      const saved = parseUnitDraft(payload.unitDraft, courseId, draft.operationRecordId);
      if (saved.unitDraftId !== draft.unitDraftId || saved.revision <= draft.revision || JSON.stringify(saved.content) !== JSON.stringify(content)) {
        throw new Error("unit-draft-save-readback-mismatch");
      }
      setDraft(saved);
      setContent(saved.content);
      setStatus("saved");
    } catch {
      if (mounted.current) setStatus("error");
    } finally { savePending.current = false; }
  }

  const message = t[status];
  const fieldClass = "w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-normal text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
  const labelClass = "grid min-w-0 gap-2 text-sm font-semibold text-[var(--foreground)]";
  return (
    <section className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4" aria-label={t.heading}>
      <h3 className="text-base font-semibold text-[var(--foreground)]">{t.heading}</h3>
      <p role="status" className="mt-2 text-sm leading-6 text-[var(--muted)]">{generationPending ? (t.generating) : message}</p>
      {content && !generationPending ? (
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <fieldset disabled={status === "saving"} className="min-w-0 space-y-4 disabled:opacity-60">
            <label className={labelClass}>{t.title}<input value={content.title} onChange={(event) => editContent({ ...content, title: event.target.value })} className={fieldClass} /></label>
            <label className={labelClass}>{t.objectives}<textarea rows={4} value={content.objectives.join("\n")} onChange={(event) => editContent({ ...content, objectives: event.target.value.split("\n") })} className={fieldClass} /></label>
            {content.activities.map((activity, index) => (
              <fieldset key={index} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] p-3">
                <legend className="px-1 text-sm font-semibold">{t.activity.replace("{n}", String(index + 1))}</legend>
                <label className={labelClass}>{t.activityTitle.replace("{n}", String(index + 1))}<input value={activity.title} onChange={(event) => editContent({ ...content, activities: content.activities.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} className={fieldClass} /></label>
                <label className={labelClass}>{t.activityDuration.replace("{n}", String(index + 1))}<input type="number" min={1} max={240} value={activity.durationMinutes} onChange={(event) => editContent({ ...content, activities: content.activities.map((item, i) => i === index ? { ...item, durationMinutes: Number(event.target.value) } : item) })} className={fieldClass} /></label>
                <label className={labelClass}>{t.activityInstructions.replace("{n}", String(index + 1))}<textarea rows={4} value={activity.instructions} onChange={(event) => editContent({ ...content, activities: content.activities.map((item, i) => i === index ? { ...item, instructions: event.target.value } : item) })} className={fieldClass} /></label>
              </fieldset>
            ))}
            <label className={labelClass}>{t.lectureScript}<textarea rows={10} value={content.lectureScript} onChange={(event) => editContent({ ...content, lectureScript: event.target.value })} className={fieldClass} /></label>
            {content.questions.map((question, index) => (
              <fieldset key={index} className="min-w-0 space-y-3 rounded-xl border border-[var(--border)] p-3">
                <legend className="px-1 text-sm font-semibold">{t.question.replace("{n}", String(index + 1))}</legend>
                <label className={labelClass}>{t.questionPrompt.replace("{n}", String(index + 1))}<textarea rows={3} value={question.prompt} onChange={(event) => editContent({ ...content, questions: content.questions.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item) })} className={fieldClass} /></label>
                <label className={labelClass}>{t.referenceAnswer.replace("{n}", String(index + 1))}<textarea rows={3} value={question.referenceAnswer} onChange={(event) => editContent({ ...content, questions: content.questions.map((item, i) => i === index ? { ...item, referenceAnswer: event.target.value } : item) })} className={fieldClass} /></label>
              </fieldset>
            ))}
            {!isTeachingUnitDraftContent(content) ? <p className="text-sm text-[var(--muted)]">{t.invalid}</p> : null}
            <button type="submit" disabled={!isTeachingUnitDraftContent(content) || status === "conflict"} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"><FloppyDisk size={18} />{status === "saving" ? (t.savingButton) : (t.saveButton)}</button>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}
