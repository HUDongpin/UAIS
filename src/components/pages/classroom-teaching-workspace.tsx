"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { Users } from "@phosphor-icons/react/dist/ssr/Users";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { ChatsCircle } from "@phosphor-icons/react/dist/ssr/ChatsCircle";
import { ClassRosterImportPanel } from "@/components/teaching/class-roster-import-panel";
import { TeachingLessonsWorkspace } from "./teaching-lessons-workspace";
import { CourseRecordRetentionPanel } from "./course-record-retention-panel";
import type { Locale } from "@/i18n/copy";
import type { TeacherCourse } from "@/data/uais";
import type {
  TeacherClassItem,
  TeacherClassMembershipItem,
} from "@/lib/teaching/course-readback";

type Tab = "lessons" | "students" | "submissions" | "discussion";
export function ClassroomTeachingWorkspace({
  locale,
  courses,
  selectedCourseId,
  onSelectCourse,
  classesByCourse,
  membershipsByClass,
  onNewCourse,
  onNewClass,
  onInvite,
  renderRoster,
}: {
  locale: Locale;
  courses: TeacherCourse[];
  selectedCourseId?: string;
  onSelectCourse: (id: string) => void;
  classesByCourse: Record<string, TeacherClassItem[]>;
  membershipsByClass: Record<string, TeacherClassMembershipItem[]>;
  onNewCourse: () => void;
  onNewClass: (courseId: string) => void;
  onInvite: (item: TeacherClassItem) => void;
  renderRoster: (item: TeacherClassItem) => ReactNode;
}) {
  const zh = locale === "zh-CN";
  const [tab, setTab] = useState<Tab>("lessons");
  const [selectedClass, setSelectedClass] = useState("");
  const course =
    courses.find((item) => item.id === selectedCourseId) ?? courses[0];
  const classes = course ? (classesByCourse[course.id] ?? []) : [];
  const classItem =
    classes.find((item) => item.id === selectedClass) ?? classes[0];
  const memberships = classes.flatMap(
    (item) => membershipsByClass[item.id] ?? [],
  );
  const approved = new Set(
    memberships
      .filter((item) => item.membershipStatus === "approved")
      .map((item) => item.studentId),
  ).size;
  const tabs = [
    {
      id: "lessons" as const,
      label: zh ? "课时与任务" : "Lessons and tasks",
      Icon: BookOpen,
    },
    {
      id: "students" as const,
      label: zh ? "学生与班级" : "Students and classes",
      Icon: Users,
    },
    {
      id: "submissions" as const,
      label: zh ? "提交与反馈" : "Submissions and feedback",
      Icon: ClipboardText,
    },
    {
      id: "discussion" as const,
      label: zh ? "课堂讨论" : "Classroom discussion",
      Icon: ChatsCircle,
    },
  ];
  const button =
    "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold";
  return (
    <section
      aria-label={zh ? "课堂教学工作台" : "Classroom teaching workspace"}
      className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)]"
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <label className="min-w-48 flex-1 text-sm font-semibold">
          {zh ? "课堂课程" : "Classroom course"}
          <select
            className="mt-2 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            value={course?.id ?? ""}
            onChange={(event) => {
              onSelectCourse(event.target.value);
              setSelectedClass("");
            }}
          >
            {courses.length === 0 ? (
              <option value="">
                {zh ? "还没有已保存课程" : "No saved courses"}
              </option>
            ) : (
              courses.map((item, index) => (
                <option value={item.id} key={item.id}>
                  {index + 1}. {item.title[locale]}
                </option>
              ))
            )}
          </select>
        </label>
        <button className={button} onClick={onNewCourse}>
          {zh ? "创建课堂课程" : "Create classroom course"}
        </button>
      </header>
      {course ? (
        <>
          <p className="text-sm text-[var(--muted)]">
            {zh
              ? `已读取 ${classes.length} 个班级 · ${approved} 名已批准学生`
              : `Loaded ${classes.length} classes · ${approved} approved students`}
          </p>
          <nav
            aria-label={zh ? "课堂功能" : "Classroom tools"}
            className="grid gap-2 sm:grid-cols-4"
          >
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold ${tab === id ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)]"}`}
              >
                <Icon size={19} />
                {label}
              </button>
            ))}
          </nav>
          {tab === "lessons" ? (
            <TeachingLessonsWorkspace
              key={course.id}
              courseId={course.id}
              locale={locale}
            />
          ) : null}
          {tab === "students" ? (
            <section className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <button
                  className={button}
                  onClick={() => onNewClass(course.id)}
                >
                  {zh ? "创建班级" : "Create class"}
                </button>
                <button
                  className={button}
                  onClick={() => window.location.reload()}
                >
                  {zh ? "刷新学生名单" : "Refresh roster"}
                </button>
              </div>
              {classes.length === 0 ? (
                <p>
                  {zh
                    ? "先创建一个班级，再导入学生名单。"
                    : "Create a class before importing students."}
                </p>
              ) : (
                <>
                  <label className="block text-sm font-semibold">
                    {zh ? "当前班级" : "Current class"}
                    <select
                      className="ml-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                      value={classItem?.id}
                      onChange={(event) => setSelectedClass(event.target.value)}
                    >
                      {classes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {classItem ? (
                    <>
                      <button
                        className={button}
                        onClick={() => onInvite(classItem)}
                      >
                        {zh ? "查看班级邀请码" : "Class invitation"}
                      </button>
                      <ClassRosterImportPanel
                        key={`${course.id}:${classItem.id}`}
                        courseId={course.id}
                        classId={classItem.id}
                        locale={locale}
                      />
                      {renderRoster(classItem)}
                    </>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
          {tab === "submissions" ? (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">
                {zh ? "审阅课堂任务" : "Review classroom work"}
              </h2>
              <p className="text-sm leading-6 text-[var(--muted)]">
                {zh
                  ? "按任务查看实际提交，发布反馈或要求修订。学生完成状态以教师接受的提交为准。"
                  : "Open an activity to review real submissions, release feedback, or request revisions. Completion follows your acceptance of student work."}
              </p>
              <Link
                href={`/teaching/courses/${encodeURIComponent(course.id)}/activities`}
                className={`${button} inline-block text-[var(--accent)]`}
              >
                {zh ? "查看任务和提交队列" : "Open tasks and submission queues"}
              </Link>
            </section>
          ) : null}
          {tab === "discussion" ? (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">
                {zh ? "课堂讨论" : "Classroom discussion"}
              </h2>
              {classes.map((item) => (
                <Link
                  key={item.id}
                  className={`${button} mr-2 inline-block`}
                  href={`/learning/chatroom?${new URLSearchParams({ courseId: course.id, classId: item.id })}`}
                >
                  {item.name}
                </Link>
              ))}
              {classes.length === 0 ? (
                <p>{zh ? "请先创建班级。" : "Create a class first."}</p>
              ) : null}
            </section>
          ) : null}
          <details className="rounded-xl border border-[var(--border)] p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              {zh ? "课程记录保留" : "Course record retention"}
            </summary>
            <div className="mt-3">
              <CourseRecordRetentionPanel
                key={course.id}
                courseId={course.id}
                locale={locale}
              />
            </div>
          </details>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          {zh
            ? "创建你的课程后，在这里准备课时、建立班级和审阅学生作业。"
            : "Create your course to prepare lessons, set up classes, and review student work here."}
        </p>
      )}
    </section>
  );
}
