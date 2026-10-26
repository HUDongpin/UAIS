import {
  normalizeLearningActivityDraft,
  type BilingualText,
  type LearningActivityDraft,
} from "@/lib/learning-loop/domain";
import {
  isTeachingUnitDraftContent,
  type TeachingUnitDraftContent,
} from "@/lib/teaching/unit-draft";
import {
  isDraftMediaSlides,
  type DraftMediaSlide,
} from "@/lib/teaching/unit-draft-media";
import type { Locale } from "@/i18n/copy";

export type LessonStudentContent = {
  title: string;
  objectives: string[];
  body: string;
  questions: Array<{ id: string; prompt: string }>;
  mediaSlides?: DraftMediaSlide[];
};
export type LessonTaskTemplate = Pick<
  LearningActivityDraft,
  "title" | "instructions" | "checkpoint" | "rubric" | "aiPolicy"
> & { id: string };
export type LessonPackageV1 = {
  schemaVersion: 1;
  primaryLocale: Locale;
  studentContent: LessonStudentContent;
  teacherGuide: {
    notes: string;
    answers: Array<{ questionId: string; answer: string }>;
  };
  tasks: LessonTaskTemplate[];
};
export type ClassroomLessonSummary = {
  lessonKey: string;
  title: string;
  position: number;
  status: "draft" | "published" | "archived";
  draftRevision: number;
  draftTaskCount: number;
  hasUnpublishedDraft: boolean;
  latestVersion: number;
  latestRelease: {
    version: number;
    draftRevision: number;
    targetClassIds: string[];
    publishedTaskCount: number;
  } | null;
  updatedAt: string;
};
export type ClassroomTeacherLesson = ClassroomLessonSummary & {
  package: LessonPackageV1;
};
export type ClassroomStudentLesson = {
  lessonKey: string;
  courseId: string;
  classId: string;
  title: string;
  position: number;
  versionId: string;
  version: number;
  content: LessonStudentContent;
  tasks: Array<{ id: string; title: BilingualText; state: string }>;
};

export class ClassroomLessonError extends Error {
  constructor(
    readonly status: number,
    readonly reasonCode: string,
  ) {
    super(reasonCode);
  }
}
function invalid(code: string): never {
  throw new ClassroomLessonError(400, code);
}
function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(code);
  return value as Record<string, unknown>;
}
function fields(input: Record<string, unknown>, keys: string[], code: string) {
  if (Object.keys(input).some((key) => !keys.includes(key))) invalid(code);
}
function text(
  value: unknown,
  max: number,
  code: string,
  empty = false,
): string {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max ||
    /\u0000/.test(value)
  )
    invalid(code);
  return value.trim();
}
function list(value: unknown, max: number, code: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(code);
  return value;
}
function id(value: unknown, code: string) {
  const result = text(value, 100, code);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) invalid(code);
  return result;
}
function bilingual(
  value: unknown,
  locale: Locale,
  code: string,
): BilingualText {
  if (typeof value === "string") {
    const content = text(value, 12_000, code);
    return { "zh-CN": content, "en-US": content };
  }
  const input = record(value, code);
  const primary = text(input[locale], 12_000, code);
  return {
    "zh-CN": input["zh-CN"] ? text(input["zh-CN"], 12_000, code) : primary,
    "en-US": input["en-US"] ? text(input["en-US"], 12_000, code) : primary,
  };
}

export function normalizeLessonPackage(
  value: unknown,
  options: { allowIncomplete?: boolean } = {},
): LessonPackageV1 {
  const input = record(value, "lesson-package-invalid");
  fields(
    input,
    [
      "schemaVersion",
      "primaryLocale",
      "studentContent",
      "teacherGuide",
      "tasks",
    ],
    "lesson-package-fields-invalid",
  );
  if (
    input.schemaVersion !== 1 ||
    !["zh-CN", "en-US"].includes(String(input.primaryLocale))
  )
    invalid("lesson-package-version-or-locale-invalid");
  const locale = input.primaryLocale as Locale;
  const student = record(
    input.studentContent,
    "lesson-student-content-invalid",
  );
  fields(
    student,
    ["title", "objectives", "body", "questions", "mediaSlides"],
    "lesson-student-content-fields-invalid",
  );
  const questions = list(student.questions, 20, "lesson-questions-invalid").map(
    (value) => {
      const q = record(value, "lesson-question-invalid");
      fields(q, ["id", "prompt"], "lesson-question-fields-invalid");
      return {
        id: id(q.id, "lesson-question-id-invalid"),
        prompt: text(q.prompt, 4000, "lesson-question-prompt-invalid"),
      };
    },
  );
  if (new Set(questions.map((q) => q.id)).size !== questions.length)
    invalid("lesson-question-id-duplicate");
  if (
    student.mediaSlides !== undefined &&
    !isDraftMediaSlides(student.mediaSlides)
  )
    invalid("lesson-media-invalid");
  const studentContent: LessonStudentContent = {
    title: text(
      student.title,
      200,
      "lesson-title-required",
      options.allowIncomplete,
    ),
    objectives: list(student.objectives, 12, "lesson-objectives-invalid").map(
      (v) => text(v, 2000, "lesson-objective-invalid"),
    ),
    body: text(
      student.body,
      50_000,
      "lesson-body-required",
      options.allowIncomplete,
    ),
    questions,
    ...(student.mediaSlides !== undefined
      ? {
          mediaSlides: structuredClone(
            student.mediaSlides as DraftMediaSlide[],
          ),
        }
      : {}),
  };
  const guide = record(input.teacherGuide, "lesson-teacher-guide-invalid");
  fields(guide, ["notes", "answers"], "lesson-teacher-guide-fields-invalid");
  const answers = list(guide.answers, 20, "lesson-answers-invalid").map(
    (value) => {
      const answer = record(value, "lesson-answer-invalid");
      fields(answer, ["questionId", "answer"], "lesson-answer-fields-invalid");
      const questionId = id(
        answer.questionId,
        "lesson-answer-question-invalid",
      );
      if (!questions.some((q) => q.id === questionId))
        invalid("lesson-answer-question-invalid");
      return {
        questionId,
        answer: text(answer.answer, 6000, "lesson-answer-invalid"),
      };
    },
  );
  if (
    new Set(answers.map((answer) => answer.questionId)).size !== answers.length
  )
    invalid("lesson-answer-question-duplicate");
  const tasks = list(input.tasks, 12, "lesson-tasks-invalid").map((value) => {
    const task = record(value, "lesson-task-invalid");
    fields(
      task,
      ["id", "title", "instructions", "checkpoint", "rubric", "aiPolicy"],
      "lesson-task-fields-invalid",
    );
    const checkpoint = record(task.checkpoint, "lesson-checkpoint-invalid");
    const normalized = normalizeLearningActivityDraft({
      lessonKey: "validation",
      targetClassId: "validation",
      title: bilingual(task.title, locale, "lesson-task-title-invalid"),
      instructions: bilingual(
        task.instructions,
        locale,
        "lesson-task-instructions-invalid",
      ),
      checkpoint: {
        ...checkpoint,
        prompt: bilingual(
          checkpoint.prompt,
          locale,
          "lesson-checkpoint-prompt-invalid",
        ),
        explanation: bilingual(
          checkpoint.explanation,
          locale,
          "lesson-checkpoint-explanation-invalid",
        ),
        ...(Array.isArray(checkpoint.options)
          ? {
              options: checkpoint.options.map((value) => {
                const option = record(value, "lesson-option-invalid");
                return {
                  id: option.id,
                  label: bilingual(
                    option.label,
                    locale,
                    "lesson-option-label-invalid",
                  ),
                };
              }),
            }
          : {}),
      },
      rubric: list(task.rubric, 5, "lesson-rubric-invalid").map((value) => {
        const dimension = record(value, "lesson-rubric-invalid");
        return {
          id: dimension.id,
          label: bilingual(
            dimension.label,
            locale,
            "lesson-rubric-label-invalid",
          ),
        };
      }),
      aiPolicy: task.aiPolicy ?? "disabled",
      revisionPolicy: "teacher-requested",
    });
    return {
      id: id(task.id, "lesson-task-id-invalid"),
      title: normalized.title,
      instructions: normalized.instructions,
      checkpoint: normalized.checkpoint,
      rubric: normalized.rubric,
      aiPolicy: normalized.aiPolicy,
    };
  });
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
    invalid("lesson-task-id-duplicate");
  const result: LessonPackageV1 = {
    schemaVersion: 1,
    primaryLocale: locale,
    studentContent,
    teacherGuide: {
      notes: text(guide.notes, 12_000, "lesson-teacher-notes-invalid", true),
      answers,
    },
    tasks,
  };
  if (
    JSON.stringify({
      ...result,
      studentContent: { ...studentContent, mediaSlides: undefined },
    }).length > 120_000
  )
    invalid("lesson-text-too-large");
  return result;
}

/** Public projection is deliberately an allowlist; never spread a teacher package here. */
export function studentLessonContent(
  value: LessonPackageV1,
): LessonStudentContent {
  const content = value.studentContent;
  return {
    title: content.title,
    objectives: [...content.objectives],
    body: content.body,
    questions: content.questions.map(({ id, prompt }) => ({ id, prompt })),
    ...(content.mediaSlides
      ? {
          mediaSlides: content.mediaSlides.map(
            ({ id, title, notes, image, audio }) => ({
              id,
              title,
              notes,
              ...(image
                ? { image: { mime: image.mime, base64: image.base64 } }
                : {}),
              ...(audio
                ? { audio: { mime: audio.mime, base64: audio.base64 } }
                : {}),
            }),
          ),
        }
      : {}),
  };
}
export function activityDraftFromTemplate(
  template: LessonTaskTemplate,
  lessonKey: string,
  targetClassId: string,
) {
  return normalizeLearningActivityDraft({
    ...template,
    lessonKey,
    targetClassId,
    revisionPolicy: "teacher-requested",
  });
}
export function lessonPackageFromUnitDraft(
  draft: TeachingUnitDraftContent,
  locale: Locale,
): LessonPackageV1 {
  if (!isTeachingUnitDraftContent(draft))
    invalid("lesson-source-draft-incomplete");
  return normalizeLessonPackage({
    schemaVersion: 1,
    primaryLocale: locale,
    studentContent: {
      title: draft.title,
      objectives: draft.objectives,
      body: [
        draft.lectureScript,
        ...draft.activities.map(
          (activity) =>
            `${activity.title} (${activity.durationMinutes} min)\n${activity.instructions}`,
        ),
      ].join("\n\n"),
      questions: draft.questions.map((q, index) => ({
        id: `q${index + 1}`,
        prompt: q.prompt,
      })),
      ...(draft.mediaSlides ? { mediaSlides: draft.mediaSlides } : {}),
    },
    teacherGuide: {
      notes: "",
      answers: draft.questions.map((q, index) => ({
        questionId: `q${index + 1}`,
        answer: q.referenceAnswer,
      })),
    },
    tasks: [],
  });
}
