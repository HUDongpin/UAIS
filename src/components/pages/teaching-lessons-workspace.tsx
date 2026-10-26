"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/copy";
import {
  normalizeLessonPackage,
  studentLessonContent,
  type ClassroomLessonSummary,
  type ClassroomTeacherLesson,
  type LessonPackageV1,
} from "@/lib/classroom-lessons/domain";
import { draftRequestByteLimit } from "@/lib/teaching/unit-draft-media";
import { LessonMaterials } from "./classroom-lesson-materials";
import { LessonTaskTemplateEditor } from "./lesson-task-template-editor";

type TargetClass = { externalId: string; name: string };
type PendingPackage = {
  name: string;
  value?: LessonPackageV1;
  error?: string;
  key: string;
  imported?: boolean;
};
const button =
  "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-40";
const field =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]";
async function request<T>(
  url: string,
  method = "GET",
  payload?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(payload
        ? {
            "content-type": "application/json",
            "idempotency-key": key ?? crypto.randomUUID(),
          }
        : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.reasonCode ?? `request-${response.status}`);
  return body as T;
}
export function classroomLessonError(error: string, zh: boolean) {
  if (error.includes("revision-conflict"))
    return zh
      ? "另一个窗口已更新此课时。你的文字仍保留；请先复制需要保留的内容，再重新读取。"
      : "Another window changed this lesson. Your text is preserved; copy changes before reloading.";
  if (error.includes("session") || error.includes("401"))
    return zh
      ? "登录已过期，请重新登录后重试。"
      : "Your session expired. Sign in again and retry.";
  if (error.includes("target-class"))
    return zh
      ? "请选择这门课程的真实班级。"
      : "Choose a class belonging to this course.";
  return zh
    ? "操作未完成。你的输入已保留，请检查连接后重试。"
    : "The operation did not finish. Your input is preserved; check the connection and retry.";
}

export function TeachingLessonsWorkspace({
  courseId,
  locale,
}: {
  courseId: string;
  locale: Locale;
}) {
  const zh = locale === "zh-CN";
  const base = `/api/teaching/courses/${encodeURIComponent(courseId)}/lessons`;
  const [lessons, setLessons] = useState<ClassroomLessonSummary[]>([]);
  const [classes, setClasses] = useState<TargetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPackage[]>([]);
  const [selected, setSelected] = useState<ClassroomTeacherLesson>();
  const [message, setMessage] = useState("");
  const [editorSession, setEditorSession] = useState(0);
  const sourceAttempt = useRef<{ source: string; key: string } | undefined>(
    undefined,
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const value = await request<{
        lessons: ClassroomLessonSummary[];
        classes: TargetClass[];
      }>(base);
      if (!Array.isArray(value.lessons) || !Array.isArray(value.classes))
        throw Error("lesson-list-invalid");
      setLessons(value.lessons);
      setClasses(value.classes);
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  async function openLesson(key: string, resetEditor = true) {
    setError("");
    try {
      const body = await request<{ lesson: ClassroomTeacherLesson }>(
        `${base}/${encodeURIComponent(key)}`,
      );
      setSelected(body.lesson);
      if (resetEditor) setEditorSession((current) => current + 1);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }
  async function chooseFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    const previews = await Promise.all(
      Array.from(files).map(async (file): Promise<PendingPackage> => {
        const key = crypto.randomUUID();
        try {
          if (file.size > draftRequestByteLimit)
            throw Error("lesson-package-too-large");
          return {
            name: file.name,
            key,
            value: normalizeLessonPackage(JSON.parse(await file.text())),
          };
        } catch (caught) {
          return { name: file.name, key, error: (caught as Error).message };
        }
      }),
    );
    setPending(previews);
  }
  async function importFiles() {
    setBusy(true);
    setError("");
    let importError = "";
    for (const item of pending) {
      if (!item.value || item.imported) continue;
      try {
        await request(base, "POST", { package: item.value }, item.key);
        setPending((current) =>
          current.map((candidate) =>
            candidate.key === item.key
              ? { ...candidate, imported: true }
              : candidate,
          ),
        );
      } catch (caught) {
        importError = (caught as Error).message;
        break;
      }
    }
    setBusy(false);
    await load();
    if (importError) setError(importError);
  }
  async function importSaved(
    source: "saved-unit-draft" | "blank" = "saved-unit-draft",
  ) {
    setBusy(true);
    setError("");
    try {
      if (sourceAttempt.current?.source !== source)
        sourceAttempt.current = { source, key: crypto.randomUUID() };
      const result = await request<{ lessonKey: string }>(
        base,
        "POST",
        {
          source,
          locale,
        },
        sourceAttempt.current.key,
      );
      sourceAttempt.current = undefined;
      await load();
      await openLesson(result.lessonKey);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5 text-[var(--foreground)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">
            {zh ? "课时与任务" : "Lessons and tasks"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {zh
              ? "先预览材料，再保存草稿并发布给班级。已发布版本和学生提交会保留。"
              : "Preview materials, save a draft, then publish to a class. Published versions and student work are preserved."}
          </p>
        </div>
        <button className={button} onClick={() => void load()}>
          {zh ? "刷新课时" : "Refresh lessons"}
        </button>
      </header>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <label className="block font-semibold">
          {zh ? "选择课时 JSON 文件" : "Select lesson JSON files"}
          <input
            aria-label={zh ? "选择课时 JSON 文件" : "Select lesson JSON files"}
            type="file"
            multiple
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => void chooseFiles(event.target.files)}
            className="mt-3 block max-w-full text-sm"
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
          {zh
            ? "每个文件一个课时；可只用文字。图片/音频每文件最多 1 MiB、每课时合计 2 MiB，最多 12 个媒体页。未提供的译文沿用原文，不自动翻译。"
            : "One lesson per file; text-only is supported. Media: 1 MiB per file, 2 MiB total per lesson, up to 12 media pages. Missing translations retain the original text."}
        </p>
        <button
          className={`${button} mt-3`}
          disabled={busy}
          onClick={() => void importSaved()}
        >
          {zh ? "从已保存教学草稿导入" : "Import saved teaching draft"}
        </button>
        <button
          className={`${button} ml-2 mt-3`}
          disabled={busy}
          onClick={() => void importSaved("blank")}
        >
          {zh ? "创建空白课时" : "Create blank lesson"}
        </button>
      </div>
      {pending.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
          <h3 className="font-semibold">
            {zh ? "导入预览（尚未保存）" : "Import preview (not saved yet)"}
          </h3>
          {pending.map((item) => (
            <article
              key={item.key}
              className="rounded-lg bg-[var(--surface-elevated)] p-3"
            >
              <p className="font-semibold">
                {item.value?.studentContent.title ?? item.name}
              </p>
              <p className="mt-1 text-sm">
                {item.imported
                  ? zh
                    ? "已保存为草稿"
                    : "Saved as draft"
                  : item.error
                    ? zh
                      ? "文件未通过校验，请修正后重新选择。"
                      : "This file failed validation; correct it and select again."
                    : `${item.value?.tasks.length ?? 0} ${zh ? "项任务" : "tasks"}`}
              </p>
              {item.value ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm">
                    {zh ? "学生材料预览" : "Preview student materials"}
                  </summary>
                  <LessonMaterials
                    content={studentLessonContent(item.value)}
                    locale={locale}
                  />
                </details>
              ) : (
                <details>
                  <summary>{zh ? "文件问题" : "File details"}</summary>
                  <p>{item.error}</p>
                </details>
              )}
            </article>
          ))}
          <button
            className={button}
            disabled={
              busy || !pending.some((item) => item.value && !item.imported)
            }
            onClick={() => void importFiles()}
          >
            {busy
              ? zh
                ? "正在保存…"
                : "Saving…"
              : zh
                ? "确认导入有效课时"
                : "Import valid lessons"}
          </button>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-[var(--danger)] p-3 text-sm"
        >
          <p>{classroomLessonError(error, zh)}</p>
          <details>
            <summary>{zh ? "查看详情" : "Details"}</summary>
            {error}
          </details>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {loading ? (
        <p>{zh ? "正在读取课时…" : "Loading lessons…"}</p>
      ) : lessons.length === 0 && !error ? (
        <p>
          {zh
            ? "尚无课时。导入材料包或从已保存的教学草稿开始。"
            : "No lessons yet. Import a package or start from a saved teaching draft."}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {lessons.map((lesson) => (
          <article
            key={lesson.lessonKey}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <p className="text-xs text-[var(--muted)]">
              {zh ? `第 ${lesson.position} 课` : `Lesson ${lesson.position}`} ·{" "}
              {lesson.latestVersion > 0
                ? zh
                  ? `最近发布 V${lesson.latestVersion}`
                  : `Latest release V${lesson.latestVersion}`
                : zh
                  ? "草稿"
                  : "Draft"}
            </p>
            <h3 className="mt-2 font-semibold">
              {lesson.title || (zh ? "未命名课时" : "Untitled lesson")}
            </h3>
            <p className="mt-2 text-sm font-medium text-[var(--foreground)]">
              {lesson.status === "archived"
                ? zh
                  ? "课时已归档"
                  : "Lesson archived"
                : lesson.latestVersion === 0
                  ? zh
                    ? "尚未发布到班级"
                    : "Not released to any class yet"
                  : lesson.hasUnpublishedDraft
                    ? zh
                      ? "草稿已更新，尚未发布"
                      : "Draft updated; not published yet"
                    : zh
                      ? `V${lesson.latestVersion} 发布后未再保存草稿`
                      : `No newer saved draft since V${lesson.latestVersion}`}
            </p>
            {typeof lesson.draftTaskCount === "number" ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {zh
                  ? `草稿任务模板：${lesson.draftTaskCount} 项`
                  : `Draft task templates: ${lesson.draftTaskCount}`}
              </p>
            ) : null}
            {lesson.latestRelease ? (
              <div className="mt-3 space-y-1 rounded-lg bg-[var(--surface-elevated)] p-3 text-xs leading-5 text-[var(--muted)]">
                <p>
                  {zh
                    ? `V${lesson.latestRelease.version} 发布到：${lesson.latestRelease.targetClassIds.map((id) => classes.find((item) => item.externalId === id)?.name ?? id).join("、")}`
                    : `V${lesson.latestRelease.version} released to: ${lesson.latestRelease.targetClassIds.map((id) => classes.find((item) => item.externalId === id)?.name ?? id).join(", ")}`}
                </p>
                <p>
                  {zh
                    ? `V${lesson.latestRelease.version} 当前已发布任务：${lesson.latestRelease.publishedTaskCount} 项（按班级计）`
                    : `V${lesson.latestRelease.version} active published tasks: ${lesson.latestRelease.publishedTaskCount} (counted per class)`}
                </p>
              </div>
            ) : null}
            <button
              className={`${button} mt-3`}
              onClick={() => void openLesson(lesson.lessonKey)}
            >
              {zh ? "编辑课时" : "Edit lesson"}
            </button>
          </article>
        ))}
      </div>
      {selected ? (
        <LessonDraftEditor
          key={`${courseId}:${selected.lessonKey}:${editorSession}`}
          lesson={selected}
          classes={classes}
          locale={locale}
          base={base}
          onReload={() => openLesson(selected.lessonKey)}
          onSaved={async () => {
            await openLesson(selected.lessonKey, false);
            await load();
          }}
          onPublished={async () => {
            setMessage(
              zh
                ? "课时和所选任务已发布。学生刷新课程后即可进入。"
                : "The lesson and selected tasks are published. Students can refresh their course to enter.",
            );
            await openLesson(selected.lessonKey, false);
            await load();
          }}
        />
      ) : null}
      <Link
        className="inline-block text-sm font-semibold text-[var(--accent)] underline"
        href={`/teaching/courses/${encodeURIComponent(courseId)}/activities`}
      >
        {zh ? "查看全部任务与提交" : "View all tasks and submissions"}
      </Link>
    </section>
  );
}

function LessonDraftEditor({
  lesson,
  classes,
  locale,
  base,
  onReload,
  onSaved,
  onPublished,
}: {
  lesson: ClassroomTeacherLesson;
  classes: TargetClass[];
  locale: Locale;
  base: string;
  onReload: () => Promise<void>;
  onSaved: () => Promise<void>;
  onPublished: () => Promise<void>;
}) {
  const zh = locale === "zh-CN";
  const [value, setValue] = useState(lesson.package);
  const [preview, setPreview] = useState(false);
  const [classIds, setClassIds] = useState(
    classes.length === 1 ? [classes[0].externalId] : [],
  );
  const [taskIds, setTaskIds] = useState(
    lesson.package.tasks.map((task) => task.id),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const publishAttempt = useRef<{ payload: string; key: string } | undefined>(
    undefined,
  );
  const dirty = JSON.stringify(value) !== JSON.stringify(lesson.package);
  function content(change: Partial<LessonPackageV1["studentContent"]>) {
    setValue({
      ...value,
      studentContent: { ...value.studentContent, ...change },
    });
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await request(`${base}/${lesson.lessonKey}`, "PATCH", {
        package: value,
        expectedRevision: lesson.draftRevision,
      });
      await onSaved();
      const submitted = JSON.stringify(value);
      setValue((current) =>
        JSON.stringify(current) === submitted
          ? normalizeLessonPackage(value, { allowIncomplete: true })
          : current,
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    setBusy(true);
    setError("");
    const payload = {
      expectedRevision: lesson.draftRevision,
      targetClassIds: classIds,
      taskIds,
    };
    const serialized = JSON.stringify(payload);
    if (publishAttempt.current?.payload !== serialized)
      publishAttempt.current = {
        payload: serialized,
        key: crypto.randomUUID(),
      };
    try {
      await request(
        `${base}/${lesson.lessonKey}/publish`,
        "POST",
        payload,
        publishAttempt.current.key,
      );
      await onPublished();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--accent-border)] bg-[var(--surface)] p-5">
      <header className="flex flex-wrap justify-between gap-3">
        <h3 className="text-xl font-semibold">
          {zh ? "编辑与发布" : "Edit and publish"}
        </h3>
        <button className={button} onClick={() => setPreview(!preview)}>
          {preview
            ? zh
              ? "返回编辑"
              : "Back to editing"
            : zh
              ? "预览学生视图"
              : "Preview student view"}
        </button>
      </header>
      {preview ? (
        <LessonMaterials
          content={studentLessonContent(value)}
          locale={locale}
        />
      ) : (
        <>
          <label className="block text-sm font-semibold">
            {zh ? "课时标题" : "Lesson title"}
            <input
              className={field}
              value={value.studentContent.title}
              onChange={(event) => content({ title: event.target.value })}
            />
          </label>
          <label className="block text-sm font-semibold">
            {zh ? "学习目标（每行一条）" : "Learning objectives (one per line)"}
            <textarea
              className={field}
              rows={3}
              value={value.studentContent.objectives.join("\n")}
              onChange={(event) =>
                content({
                  objectives: event.target.value.split("\n").filter(Boolean),
                })
              }
            />
          </label>
          <label className="block text-sm font-semibold">
            {zh ? "学生讲解正文" : "Student lesson text"}
            <textarea
              className={field}
              rows={12}
              value={value.studentContent.body}
              onChange={(event) => content({ body: event.target.value })}
            />
          </label>
          {value.studentContent.questions.map((question, index) => (
            <label key={question.id} className="block text-sm">
              {zh ? `思考问题 ${index + 1}` : `Question ${index + 1}`}
              <textarea
                className={field}
                value={question.prompt}
                onChange={(event) =>
                  content({
                    questions: value.studentContent.questions.map((q) =>
                      q.id === question.id
                        ? { ...q, prompt: event.target.value }
                        : q,
                    ),
                  })
                }
              />
            </label>
          ))}
          <details className="rounded-lg bg-[var(--surface-elevated)] p-3">
            <summary className="cursor-pointer font-semibold">
              {zh ? "教师备课信息（学生不可见）" : "Teacher guide (private)"}
            </summary>
            <label className="mt-3 block text-sm">
              {zh ? "教师备注" : "Teacher notes"}
              <textarea
                className={field}
                rows={3}
                value={value.teacherGuide.notes}
                onChange={(event) =>
                  setValue({
                    ...value,
                    teacherGuide: {
                      ...value.teacherGuide,
                      notes: event.target.value,
                    },
                  })
                }
              />
            </label>
            {value.teacherGuide.answers.map((answer) => (
              <label key={answer.questionId} className="mt-3 block text-sm">
                {
                  value.studentContent.questions.find(
                    (q) => q.id === answer.questionId,
                  )?.prompt
                }
                <textarea
                  className={field}
                  value={answer.answer}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      teacherGuide: {
                        ...value.teacherGuide,
                        answers: value.teacherGuide.answers.map((a) =>
                          a.questionId === answer.questionId
                            ? { ...a, answer: event.target.value }
                            : a,
                        ),
                      },
                    })
                  }
                />
              </label>
            ))}
          </details>
        </>
      )}
      <fieldset className="space-y-2">
        <legend className="font-semibold">
          {zh ? "同时发布的任务" : "Tasks to publish with this lesson"}
        </legend>
        {value.tasks.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {zh
              ? "此课时没有附带任务。发布后仍可创建学习任务。"
              : "No tasks are included. You can add an activity after publishing."}
          </p>
        ) : (
          value.tasks.map((task) => (
            <div key={task.id} className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={taskIds.includes(task.id)}
                  onChange={(event) =>
                    setTaskIds(
                      event.target.checked
                        ? [...taskIds, task.id]
                        : taskIds.filter((id) => id !== task.id),
                    )
                  }
                />
                <span>
                  {task.title[locale]}
                  <span className="mt-1 block text-[var(--muted)]">
                    {task.instructions[locale]}
                  </span>
                </span>
              </label>
              {!preview ? (
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
                    {zh ? "修改任务内容" : "Edit task content"}
                  </summary>
                  <LessonTaskTemplateEditor
                    task={task}
                    primaryLocale={value.primaryLocale}
                    locale={locale}
                    onChange={(updated) =>
                      setValue({
                        ...value,
                        tasks: value.tasks.map((item) =>
                          item.id === task.id ? updated : item,
                        ),
                      })
                    }
                  />
                </details>
              ) : null}
            </div>
          ))
        )}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">
          {zh ? "发布到班级" : "Publish to classes"}
        </legend>
        {classes.length === 0 ? (
          <p className="text-sm">
            {zh
              ? "请先在学生与班级中创建班级。"
              : "Create a class in Students and classes first."}
          </p>
        ) : (
          classes.map((item) => (
            <label
              key={item.externalId}
              className="mr-4 inline-flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={classIds.includes(item.externalId)}
                onChange={(event) =>
                  setClassIds(
                    event.target.checked
                      ? [...classIds, item.externalId]
                      : classIds.filter((id) => id !== item.externalId),
                  )
                }
              />
              {item.name}
            </label>
          ))
        )}
      </fieldset>
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-[var(--danger)] p-3 text-sm"
        >
          <p>{classroomLessonError(error, zh)}</p>
          <button className={`${button} mt-2`} onClick={() => void onReload()}>
            {zh ? "重新读取服务端草稿" : "Reload server draft"}
          </button>
          <details>
            <summary>{zh ? "详情" : "Details"}</summary>
            {error}
          </details>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={button}
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {zh ? "保存草稿" : "Save draft"}
        </button>
        <button
          className={`${button} bg-[var(--accent)] text-white`}
          disabled={
            busy ||
            dirty ||
            classIds.length === 0 ||
            !value.studentContent.title.trim() ||
            !value.studentContent.body.trim()
          }
          onClick={() => void publish()}
        >
          {busy
            ? zh
              ? "正在处理…"
              : "Working…"
            : zh
              ? "确认发布课时与所选任务"
              : "Publish lesson and selected tasks"}
        </button>
        {dirty ? (
          <p className="text-sm text-[var(--muted)]">
            {zh ? "请先保存修改，再发布。" : "Save changes before publishing."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
