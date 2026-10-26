"use client";
import type { Locale } from "@/i18n/copy";
import type { BilingualText } from "@/lib/learning-loop/domain";
import type { LessonTaskTemplate } from "@/lib/classroom-lessons/domain";
const input =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
/** Keep an explicitly supplied translation; propagate only an untranslated copy. */
function editPrimary(
  value: BilingualText,
  locale: Locale,
  text: string,
): BilingualText {
  const other = locale === "zh-CN" ? "en-US" : "zh-CN";
  return {
    ...value,
    [locale]: text,
    ...(value[other] === value[locale] ? { [other]: text } : {}),
  };
}
export function LessonTaskTemplateEditor({
  task,
  primaryLocale,
  locale,
  onChange,
}: {
  task: LessonTaskTemplate;
  primaryLocale: Locale;
  locale: Locale;
  onChange: (task: LessonTaskTemplate) => void;
}) {
  const zh = locale === "zh-CN";
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
      <p className="text-xs text-[var(--muted)]">
        {zh
          ? "编辑材料的主要语言；已有译文会保留，未翻译的副本会同步原文。"
          : "Edit the lesson’s primary language. Existing translations stay intact; untranslated copies follow the original."}
      </p>
      <label className="block text-sm font-semibold">
        {zh ? "任务标题" : "Task title"}
        <input
          className={input}
          value={task.title[primaryLocale]}
          onChange={(event) =>
            onChange({
              ...task,
              title: editPrimary(task.title, primaryLocale, event.target.value),
            })
          }
        />
      </label>
      <label className="block text-sm font-semibold">
        {zh ? "任务说明" : "Task instructions"}
        <textarea
          className={input}
          rows={4}
          value={task.instructions[primaryLocale]}
          onChange={(event) =>
            onChange({
              ...task,
              instructions: editPrimary(
                task.instructions,
                primaryLocale,
                event.target.value,
              ),
            })
          }
        />
      </label>
      <label className="block text-sm font-semibold">
        {zh ? "形成性检查题" : "Formative checkpoint"}
        <textarea
          className={input}
          value={task.checkpoint.prompt[primaryLocale]}
          onChange={(event) =>
            onChange({
              ...task,
              checkpoint: {
                ...task.checkpoint,
                prompt: editPrimary(
                  task.checkpoint.prompt,
                  primaryLocale,
                  event.target.value,
                ),
              },
            })
          }
        />
      </label>
      <label className="block text-sm font-semibold">
        {zh
          ? "检查题解释（作答后可见）"
          : "Checkpoint explanation (visible after attempting)"}
        <textarea
          className={input}
          value={task.checkpoint.explanation[primaryLocale]}
          onChange={(event) =>
            onChange({
              ...task,
              checkpoint: {
                ...task.checkpoint,
                explanation: editPrimary(
                  task.checkpoint.explanation,
                  primaryLocale,
                  event.target.value,
                ),
              },
            })
          }
        />
      </label>
      {task.checkpoint.kind === "single-choice" ? (
        <>
          <label className="block text-sm font-semibold">
            {zh ? "正确选项" : "Correct option"}
            <select
              className={input}
              value={task.checkpoint.correctOptionId}
              onChange={(event) => {
                if (task.checkpoint.kind === "single-choice")
                  onChange({
                    ...task,
                    checkpoint: {
                      ...task.checkpoint,
                      correctOptionId: event.target.value,
                    },
                  });
              }}
            >
              {task.checkpoint.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label[primaryLocale]}
                </option>
              ))}
            </select>
          </label>
          {task.checkpoint.options.map((option, index) => (
            <label key={option.id} className="block text-sm">
              {zh ? `选项 ${index + 1}` : `Option ${index + 1}`}
              <input
                className={input}
                value={option.label[primaryLocale]}
                onChange={(event) => {
                  if (task.checkpoint.kind === "single-choice")
                    onChange({
                      ...task,
                      checkpoint: {
                        ...task.checkpoint,
                        options: task.checkpoint.options.map((item) =>
                          item.id === option.id
                            ? {
                                ...item,
                                label: editPrimary(
                                  item.label,
                                  primaryLocale,
                                  event.target.value,
                                ),
                              }
                            : item,
                        ),
                      },
                    });
                }}
              />
            </label>
          ))}
        </>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">
          {zh ? "评价量规" : "Rubric"}
        </legend>
        {task.rubric.map((dimension, index) => (
          <label key={dimension.id} className="block text-sm">
            {zh ? `量规维度 ${index + 1}` : `Rubric dimension ${index + 1}`}
            <input
              className={input}
              value={dimension.label[primaryLocale]}
              onChange={(event) =>
                onChange({
                  ...task,
                  rubric: task.rubric.map((item) =>
                    item.id === dimension.id
                      ? {
                          ...item,
                          label: editPrimary(
                            item.label,
                            primaryLocale,
                            event.target.value,
                          ),
                        }
                      : item,
                  ),
                })
              }
            />
          </label>
        ))}
      </fieldset>
      <label className="block text-sm font-semibold">
        {zh ? "教师 AI 反馈草稿" : "Teacher AI feedback drafts"}
        <select
          className={input}
          value={task.aiPolicy}
          onChange={(event) =>
            onChange({
              ...task,
              aiPolicy: event.target.value as LessonTaskTemplate["aiPolicy"],
            })
          }
        >
          <option value="disabled">
            {zh ? "关闭；使用人工反馈" : "Off; manual feedback"}
          </option>
          <option value="teacher-requested-draft">
            {zh
              ? "教师主动请求后生成"
              : "Generate only when a teacher requests"}
          </option>
        </select>
      </label>
    </div>
  );
}
