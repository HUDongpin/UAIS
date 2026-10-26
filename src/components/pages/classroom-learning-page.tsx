"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAppPreferences } from "@/components/providers/app-preferences";
import {
  createLearningReturnPath,
  createLoginHandoffHref,
} from "@/lib/auth/login-return-path";
import type { ClassroomStudentLesson } from "@/lib/classroom-lessons/domain";
import { LessonMaterials } from "./classroom-lesson-materials";
import { LearningPracticePanel } from "./learning-practice-panel";
import { classroomLessonError } from "./teaching-lessons-workspace";

type EntryProps = {
  courseId: string;
  classId?: string;
  lessonKey?: string;
  activityId?: string;
  legacy?: ReactNode;
};
type LessonList = {
  classId: string;
  lessons: Array<{
    lessonKey: string;
    title: string;
    position: number;
    version: number;
  }>;
};
export function ClassroomCourseRouter({
  courseId,
  classId,
  lessonKey,
  activityId,
  legacy,
}: EntryProps) {
  const { locale } = useAppPreferences();
  const zh = locale === "zh-CN";
  const [list, setList] = useState<LessonList>();
  const [lesson, setLesson] = useState<ClassroomStudentLesson>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setLesson(undefined);
      try {
        const query = new URLSearchParams(classId ? { classId } : {});
        const base = `/api/learning/courses/${encodeURIComponent(courseId)}/lessons`;
        const response = await fetch(`${base}?${query}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const body = await response.json();
        if (!response.ok)
          throw Error(body.reasonCode ?? `request-${response.status}`);
        const entries: LessonList = {
          classId: body.classId ?? classId ?? "",
          lessons: Array.isArray(body.lessons) ? body.lessons : [],
        };
        if (cancelled) return;
        setList(entries);
        const selected = lessonKey ?? entries.lessons[0]?.lessonKey;
        if (!selected) {
          setLoading(false);
          return;
        }
        query.set("classId", entries.classId);
        if (activityId) query.set("activityId", activityId);
        const itemResponse = await fetch(
          `${base}/${encodeURIComponent(selected)}?${query}`,
          { cache: "no-store", headers: { accept: "application/json" } },
        );
        const item = await itemResponse.json();
        if (!itemResponse.ok || !item.lesson)
          throw Error(item.reasonCode ?? "published-classroom-lesson-required");
        if (!cancelled) setLesson(item.lesson);
      } catch (caught) {
        if (!cancelled) setError((caught as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [courseId, classId, lessonKey, activityId, retry]);
  if (!loading && !error && list?.lessons.length === 0 && !lessonKey && legacy)
    return legacy;
  const activeActivity = activityId ?? lesson?.tasks[0]?.id;
  const returnPath = createLearningReturnPath({
    courseId,
    classId: lesson?.classId ?? classId,
    lessonKey: lesson?.lessonKey ?? lessonKey,
    activityId: activeActivity,
  });
  return (
    <main className="space-y-5 text-[var(--foreground)]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">
            {zh ? "课堂学习" : "Classroom learning"}
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {zh
              ? "选择课时，阅读材料，然后完成教师发布的任务。"
              : "Choose a lesson, read the materials, and complete your teacher’s tasks."}
          </p>
        </div>
        <Link
          className="font-semibold text-[var(--accent)] underline"
          href={`/learning/chatroom?${new URLSearchParams({ courseId, ...((lesson?.classId ?? classId) ? { classId: lesson?.classId ?? classId ?? "" } : {}) })}`}
        >
          {zh ? "进入课堂讨论" : "Open classroom discussion"}
        </Link>
      </header>
      {error ? (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-[var(--danger)] p-4"
        >
          <p>{classroomLessonError(error, zh)}</p>
          <button
            className="rounded-full border border-[var(--border)] px-4 py-2"
            onClick={() => setRetry((value) => value + 1)}
          >
            {zh ? "重试读取" : "Retry"}
          </button>
          {error.includes("session") || error.includes("401") ? (
            <Link
              href={createLoginHandoffHref(returnPath)}
              className="ml-3 underline"
            >
              {zh ? "重新登录并返回" : "Sign in and return"}
            </Link>
          ) : null}
          <details>
            <summary>{zh ? "详情" : "Details"}</summary>
            {error}
          </details>
        </div>
      ) : null}
      {loading ? (
        <p role="status">
          {zh ? "正在读取课堂材料…" : "Loading classroom materials…"}
        </p>
      ) : null}
      <nav
        aria-label={zh ? "课时目录" : "Lesson directory"}
        className="flex flex-wrap gap-2"
      >
        {list?.lessons.map((item) => (
          <Link
            key={item.lessonKey}
            href={createLearningReturnPath({
              courseId,
              classId: list.classId,
              lessonKey: item.lessonKey,
            })}
            aria-current={
              item.lessonKey === lesson?.lessonKey ? "page" : undefined
            }
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold aria-[current=page]:border-[var(--accent)] aria-[current=page]:text-[var(--accent)]"
          >
            {item.position}. {item.title}
          </Link>
        ))}
      </nav>
      {lesson ? (
        <>
          <p className="text-xs text-[var(--muted)]">
            {zh
              ? `课时版本 V${lesson.version}`
              : `Lesson version V${lesson.version}`}
          </p>
          <LessonMaterials content={lesson.content} locale={locale} />
          <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-xl font-semibold">
              {zh ? "本课任务" : "Lesson tasks"}
            </h2>
            {lesson.tasks.length === 0 ? (
              <p>
                {zh
                  ? "教师尚未为本课发布任务。"
                  : "Your teacher has not published tasks for this lesson."}
              </p>
            ) : (
              <>
                <nav
                  aria-label={zh ? "本课任务" : "Lesson tasks"}
                  className="flex flex-wrap gap-2"
                >
                  {lesson.tasks.map((task) => (
                    <Link
                      key={task.id}
                      href={createLearningReturnPath({
                        courseId,
                        classId: lesson.classId,
                        lessonKey: lesson.lessonKey,
                        activityId: task.id,
                      })}
                      aria-current={
                        task.id === activeActivity ? "page" : undefined
                      }
                      className="rounded-full border border-[var(--border)] px-4 py-2 text-sm aria-[current=page]:border-[var(--accent)]"
                    >
                      {task.title[locale]}
                    </Link>
                  ))}
                </nav>
                <LearningPracticePanel
                  locale={locale}
                  courseId={courseId}
                  classId={lesson.classId}
                  lessonKey={lesson.lessonKey}
                  requestedActivityId={activeActivity}
                  signInHref={createLoginHandoffHref(returnPath)}
                />
              </>
            )}
          </section>
        </>
      ) : null}
      {!loading && !error && list?.lessons.length === 0 && !lesson ? (
        <p>
          {zh
            ? "教师尚未向你的班级发布课时。"
            : "Your teacher has not published lessons to your class yet."}
        </p>
      ) : null}
    </main>
  );
}
