"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { Locale } from "@/i18n/copy";
import type { LearningActivityDraft } from "@/lib/learning-loop/domain";
import {
  formatUtcForHongKongDateTimeInput,
  parseHongKongDateTimeInput,
} from "@/lib/learning-loop/hong-kong-time";
import type {
  TeacherCourseClass,
  TeacherLearningActivity,
} from "./teaching-learning-loop-types";

type EditorIntent = "create" | "save" | "create-version";

type FormState = {
  lessonKey: string;
  targetClassId: string;
  titleZh: string;
  titleEn: string;
  instructionsZh: string;
  instructionsEn: string;
  checkpointKind: "short-answer" | "single-choice";
  checkpointPromptZh: string;
  checkpointPromptEn: string;
  checkpointExplanationZh: string;
  checkpointExplanationEn: string;
  options: Array<{ id: string; zh: string; en: string }>;
  correctOptionId: string;
  rubric: Array<{ id: string; zh: string; en: string }>;
  dueAtLocal: string;
  aiPolicy: "teacher-requested-draft" | "disabled";
};

export function TeachingLearningActivityForm({
  locale,
  lessonKey,
  classes,
  intent,
  source,
  onSubmit,
  onCancel,
}: {
  locale: Locale;
  lessonKey: string;
  classes: TeacherCourseClass[];
  intent: EditorIntent;
  source?: TeacherLearningActivity;
  onSubmit: (draft: LearningActivityDraft) => Promise<void>;
  onCancel?: () => void;
}) {
  const zh = locale === "zh-CN";
  const [form, setForm] = useState<FormState>(() => createInitialState(lessonKey, classes, source));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(createActivityDraft(form));
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : zh
            ? "任务未保存，请检查字段后重试。"
            : "The activity was not saved. Check the fields and retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">P1 · {zh ? "真实学习任务" : "Real learning activity"}</p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">{editorTitle(intent, zh)}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{zh ? "发布前必须同时完成中英文说明、形成性检查和 3–5 项量规。" : "Both locales, one checkpoint, and 3–5 rubric dimensions are required before publishing."}</p>
        </div>
        <button type="button" onClick={() => setPreview((value) => !value)} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]">{preview ? (zh ? "返回编辑" : "Back to edit") : (zh ? "预览学生视图" : "Preview student view")}</button>
      </header>

      {preview ? (
        <ActivityPreview locale={locale} form={form} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={zh ? "课件单元键" : "Lesson key"}><input value={form.lessonKey} readOnly className={inputClassName} /></Field>
            <Field label={zh ? "目标班级" : "Target class"}><select required value={form.targetClassId} onChange={(event) => setForm({ ...form, targetClassId: event.target.value })} className={inputClassName}><option value="">{zh ? "请选择真实班级" : "Select a real class"}</option>{classes.map((item) => <option key={item.classId} value={item.classId}>{item.className}</option>)}</select></Field>
            <Field label="标题 · zh-CN"><input required value={form.titleZh} onChange={(event) => setForm({ ...form, titleZh: event.target.value })} className={inputClassName} /></Field>
            <Field label="Title · en-US"><input required value={form.titleEn} onChange={(event) => setForm({ ...form, titleEn: event.target.value })} className={inputClassName} /></Field>
            <Field label="说明 · zh-CN"><textarea required rows={4} value={form.instructionsZh} onChange={(event) => setForm({ ...form, instructionsZh: event.target.value })} className={textareaClassName} /></Field>
            <Field label="Instructions · en-US"><textarea required rows={4} value={form.instructionsEn} onChange={(event) => setForm({ ...form, instructionsEn: event.target.value })} className={textareaClassName} /></Field>
          </div>

          <fieldset className="space-y-4 rounded-xl border border-[var(--border)] p-4">
            <legend className="px-2 font-semibold text-[var(--foreground)]">{zh ? "必做形成性检查" : "Required formative checkpoint"}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={zh ? "题型" : "Question type"}><select value={form.checkpointKind} onChange={(event) => setForm({ ...form, checkpointKind: event.target.value as FormState["checkpointKind"] })} className={inputClassName}><option value="short-answer">{zh ? "短答" : "Short answer"}</option><option value="single-choice">{zh ? "单选" : "Single choice"}</option></select></Field>
              <Field label={zh ? "AI 反馈策略" : "AI feedback policy"}><select value={form.aiPolicy} onChange={(event) => setForm({ ...form, aiPolicy: event.target.value as FormState["aiPolicy"] })} className={inputClassName}><option value="teacher-requested-draft">{zh ? "教师按需生成草稿" : "Teacher-requested draft"}</option><option value="disabled">{zh ? "禁用 AI 草稿" : "AI draft disabled"}</option></select></Field>
              <Field label="问题 · zh-CN"><input required value={form.checkpointPromptZh} onChange={(event) => setForm({ ...form, checkpointPromptZh: event.target.value })} className={inputClassName} /></Field>
              <Field label="Prompt · en-US"><input required value={form.checkpointPromptEn} onChange={(event) => setForm({ ...form, checkpointPromptEn: event.target.value })} className={inputClassName} /></Field>
              <Field label="解释 · zh-CN"><textarea required rows={3} value={form.checkpointExplanationZh} onChange={(event) => setForm({ ...form, checkpointExplanationZh: event.target.value })} className={textareaClassName} /></Field>
              <Field label="Explanation · en-US"><textarea required rows={3} value={form.checkpointExplanationEn} onChange={(event) => setForm({ ...form, checkpointExplanationEn: event.target.value })} className={textareaClassName} /></Field>
            </div>
            {form.checkpointKind === "single-choice" ? <CheckpointOptions form={form} setForm={setForm} locale={locale} /> : null}
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-[var(--border)] p-4">
            <legend className="px-2 font-semibold text-[var(--foreground)]">{zh ? "非数字量规（3–5 项）" : "Non-numeric rubric (3–5 dimensions)"}</legend>
            {form.rubric.map((dimension, index) => (
              <div key={dimension.id} className="grid gap-2 sm:grid-cols-[110px_1fr_1fr_auto]">
                <input aria-label={`${zh ? "量规 ID" : "Rubric ID"} ${index + 1}`} required value={dimension.id} onChange={(event) => setForm({ ...form, rubric: replaceAt(form.rubric, index, { ...dimension, id: safeIdentifier(event.target.value) }) })} className={inputClassName} />
                <input aria-label={`量规 ${index + 1} zh-CN`} required placeholder="zh-CN" value={dimension.zh} onChange={(event) => setForm({ ...form, rubric: replaceAt(form.rubric, index, { ...dimension, zh: event.target.value }) })} className={inputClassName} />
                <input aria-label={`Rubric ${index + 1} en-US`} required placeholder="en-US" value={dimension.en} onChange={(event) => setForm({ ...form, rubric: replaceAt(form.rubric, index, { ...dimension, en: event.target.value }) })} className={inputClassName} />
                <button type="button" disabled={form.rubric.length <= 3} onClick={() => setForm({ ...form, rubric: form.rubric.filter((_, itemIndex) => itemIndex !== index) })} className="rounded-lg border border-[var(--border)] px-3 text-sm font-semibold disabled:opacity-40">{zh ? "移除" : "Remove"}</button>
              </div>
            ))}
            <button type="button" disabled={form.rubric.length >= 5} onClick={() => setForm({ ...form, rubric: [...form.rubric, { id: `criterion-${form.rubric.length + 1}`, zh: "", en: "" }] })} className="rounded-full border border-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent)] disabled:opacity-40">{zh ? "增加量规维度" : "Add rubric dimension"}</button>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={zh ? "截止时间（香港界面时间）" : "Due time (Hong Kong display time)"}><input type="datetime-local" value={form.dueAtLocal} onChange={(event) => setForm({ ...form, dueAtLocal: event.target.value })} className={inputClassName} /></Field>
            <div className="rounded-xl bg-[var(--surface-elevated)] p-3 text-xs leading-5 text-[var(--muted)]">{zh ? "学生提交仅接受最多 20,000 字符的纯文本或受限 Markdown；不接收附件、HTML 或嵌入内容。" : "Student evidence accepts at most 20,000 characters of plain text or restricted Markdown—no files, HTML, or embeds."}</div>
          </div>
        </>
      )}

      {error ? <p role="alert" className="text-sm font-medium text-[var(--danger)]">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || classes.length === 0 || !lessonKey} className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? (zh ? "正在持久化…" : "Persisting…") : submitLabel(intent, zh)}</button>
        {onCancel ? <button type="button" onClick={onCancel} className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold">{zh ? "取消" : "Cancel"}</button> : null}
      </div>
    </form>
  );
}

function CheckpointOptions({ form, setForm, locale }: { form: FormState; setForm: (value: FormState) => void; locale: Locale }) {
  const zh = locale === "zh-CN";
  return <div className="space-y-2"><p className="text-sm font-semibold text-[var(--foreground)]">{zh ? "选项与正确解释键" : "Options and explanation key"}</p>{form.options.map((option, index) => <div key={option.id} className="grid gap-2 sm:grid-cols-[80px_1fr_1fr]"><label className="flex items-center gap-2 text-sm"><input type="radio" name="correct-option" checked={form.correctOptionId === option.id} onChange={() => setForm({ ...form, correctOptionId: option.id })} />{zh ? "正确" : "Correct"}</label><input aria-label={`选项 ${index + 1} zh-CN`} required value={option.zh} onChange={(event) => setForm({ ...form, options: replaceAt(form.options, index, { ...option, zh: event.target.value }) })} className={inputClassName} /><input aria-label={`Option ${index + 1} en-US`} required value={option.en} onChange={(event) => setForm({ ...form, options: replaceAt(form.options, index, { ...option, en: event.target.value }) })} className={inputClassName} /></div>)}</div>;
}

function ActivityPreview({ locale, form }: { locale: Locale; form: FormState }) {
  const zh = locale === "zh-CN";
  return <section className="space-y-4 rounded-xl border border-[var(--accent-border)] bg-[var(--surface-elevated)] p-5"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{zh ? "学生视图预览（尚未发布）" : "Student preview (not published)"}</p><h3 className="text-lg font-semibold">{zh ? form.titleZh : form.titleEn}</h3><p className="whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{zh ? form.instructionsZh : form.instructionsEn}</p><p className="font-semibold">{zh ? form.checkpointPromptZh : form.checkpointPromptEn}</p><ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">{form.rubric.map((item) => <li key={item.id}>{zh ? item.zh : item.en}</li>)}</ul></section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-semibold text-[var(--foreground)]"><span className="mb-2 block">{label}</span>{children}</label>;
}

function createInitialState(lessonKey: string, classes: TeacherCourseClass[], source?: TeacherLearningActivity): FormState {
  const checkpoint = source?.checkpoint;
  return {
    lessonKey: source?.lessonKey ?? lessonKey,
    targetClassId: source?.targetClassId ?? classes[0]?.classId ?? "",
    titleZh: source?.title["zh-CN"] ?? "",
    titleEn: source?.title["en-US"] ?? "",
    instructionsZh: source?.instructions["zh-CN"] ?? "",
    instructionsEn: source?.instructions["en-US"] ?? "",
    checkpointKind: checkpoint?.kind ?? "short-answer",
    checkpointPromptZh: checkpoint?.prompt["zh-CN"] ?? "",
    checkpointPromptEn: checkpoint?.prompt["en-US"] ?? "",
    checkpointExplanationZh: checkpoint?.explanation["zh-CN"] ?? "",
    checkpointExplanationEn: checkpoint?.explanation["en-US"] ?? "",
    options: checkpoint?.kind === "single-choice" ? checkpoint.options.map((item) => ({ id: item.id, zh: item.label["zh-CN"], en: item.label["en-US"] })) : defaultOptions(),
    correctOptionId: checkpoint?.kind === "single-choice" ? checkpoint.correctOptionId : "option-a",
    rubric: source?.rubric.map((item) => ({ id: item.id, zh: item.label["zh-CN"], en: item.label["en-US"] })) ?? defaultRubric(),
    dueAtLocal: source?.dueAt ? formatUtcForHongKongDateTimeInput(source.dueAt) : "",
    aiPolicy: source?.aiPolicy ?? "teacher-requested-draft",
  };
}

function createActivityDraft(form: FormState): LearningActivityDraft {
  const checkpoint = form.checkpointKind === "single-choice" ? { kind: "single-choice" as const, prompt: { "zh-CN": form.checkpointPromptZh, "en-US": form.checkpointPromptEn }, explanation: { "zh-CN": form.checkpointExplanationZh, "en-US": form.checkpointExplanationEn }, options: form.options.map((item) => ({ id: item.id, label: { "zh-CN": item.zh, "en-US": item.en } })), correctOptionId: form.correctOptionId } : { kind: "short-answer" as const, prompt: { "zh-CN": form.checkpointPromptZh, "en-US": form.checkpointPromptEn }, explanation: { "zh-CN": form.checkpointExplanationZh, "en-US": form.checkpointExplanationEn } };
  return { lessonKey: form.lessonKey, targetClassId: form.targetClassId, title: { "zh-CN": form.titleZh, "en-US": form.titleEn }, instructions: { "zh-CN": form.instructionsZh, "en-US": form.instructionsEn }, checkpoint, rubric: form.rubric.map((item) => ({ id: item.id, label: { "zh-CN": item.zh, "en-US": item.en } })), ...(form.dueAtLocal ? { dueAt: parseHongKongDateTimeInput(form.dueAtLocal) } : {}), aiPolicy: form.aiPolicy, revisionPolicy: "teacher-requested", status: "draft", version: 1 };
}

function defaultOptions() { return [{ id: "option-a", zh: "", en: "" }, { id: "option-b", zh: "", en: "" }, { id: "option-c", zh: "", en: "" }]; }
function defaultRubric() { return [{ id: "claim", zh: "", en: "" }, { id: "evidence", zh: "", en: "" }, { id: "reasoning", zh: "", en: "" }]; }
function replaceAt<T>(items: T[], index: number, value: T) { return items.map((item, itemIndex) => itemIndex === index ? value : item); }
function safeIdentifier(value: string) { return value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+/, ""); }
function editorTitle(intent: EditorIntent, zh: boolean) { return intent === "create" ? (zh ? "新建任务草稿" : "Create activity draft") : intent === "save" ? (zh ? "编辑未发布任务" : "Edit unpublished activity") : (zh ? "基于已发布任务创建新版本" : "Create a new version from published activity"); }
function submitLabel(intent: EditorIntent, zh: boolean) { return intent === "create" ? (zh ? "保存任务草稿" : "Save activity draft") : intent === "save" ? (zh ? "保存修改" : "Save changes") : (zh ? "创建新版本草稿" : "Create version draft"); }

const inputClassName = "h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--accent)]";
const textareaClassName = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-[var(--accent)]";
