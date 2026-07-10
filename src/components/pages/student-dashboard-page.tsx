"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { ChatTeardropText } from "@phosphor-icons/react/dist/ssr/ChatTeardropText";
import { CheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/dist/ssr/ClockCountdown";
import { Compass } from "@phosphor-icons/react/dist/ssr/Compass";
import { GraduationCap } from "@phosphor-icons/react/dist/ssr/GraduationCap";
import { Notebook } from "@phosphor-icons/react/dist/ssr/Notebook";
import { Robot } from "@phosphor-icons/react/dist/ssr/Robot";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Target } from "@phosphor-icons/react/dist/ssr/Target";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { localizedText } from "@/components/ui/localized-text";
import { aiAgents, chatMessages, learningCourses, plazaCourses } from "@/data/uais";

const dashboardCopy = {
  "zh-CN": {
    title: "学生看板",
    summary:
      "汇总当前课程、学习进度、智能导学和小组协作，让学生进入系统后先看到今天该做什么。",
    sidebarTitle: "学习入口",
    currentState: "今日学习状态",
    progress: "课程进度",
    aiGuide: "智能导学",
    collaboration: "协作记录",
    status: "正在学习",
    statusNote: "2 门课程处于本周学习节奏中",
    nextTask: "下一步",
    nextTaskNote: "继续观看康霞博士课件讲解并完成小组证据链草案",
    aiReady: "智能助教",
    aiReadyNote: "4 个智能体可用于研究、方法、数学和写作支持",
    quickActions: "学生看板快捷入口",
    continueLearning: "继续学习",
    openChatroom: "进入聊天室",
    browseCourses: "浏览课程",
    learningSnapshot: "我的学习快照",
    classMemberships: "班级加入状态",
    approvedMembership: "已加入",
    pendingMembership: "等待教师审批",
    aiGuideTitle: "智能导学建议",
    chatTitle: "人机协作聊天室",
    plazaTitle: "课程广场",
    activeCourse: "当前课程",
    unitFocus: "本周重点",
    groupSignal: "小组协作线索",
    courseOpportunity: "可继续探索课程",
  },
  "en-US": {
    title: "Student Dashboard",
    summary:
      "A student-first home for current courses, learning progress, AI guidance, and group collaboration.",
    sidebarTitle: "Learning Entry",
    currentState: "Today",
    progress: "Course Progress",
    aiGuide: "AI Guide",
    collaboration: "Collaboration",
    status: "In Progress",
    statusNote: "2 courses are active in this week's learning rhythm",
    nextTask: "Next Step",
    nextTaskNote: "Continue Dr. Kang's narrated PPT and complete the group evidence-chain draft",
    aiReady: "AI Tutors",
    aiReadyNote: "4 agents support research, methods, math, and writing",
    quickActions: "Student dashboard shortcuts",
    continueLearning: "Continue",
    openChatroom: "Open Chatroom",
    browseCourses: "Browse Courses",
    learningSnapshot: "My Learning Snapshot",
    classMemberships: "Class Join Status",
    approvedMembership: "Joined",
    pendingMembership: "Waiting for Teacher Review",
    aiGuideTitle: "AI Guidance",
    chatTitle: "Human-AI Collaboration Chatroom",
    plazaTitle: "Course Plaza",
    activeCourse: "Active Course",
    unitFocus: "Weekly Focus",
    groupSignal: "Group Signal",
    courseOpportunity: "Courses to Explore",
  },
} as const;

const sidebarItems = [
  { id: "state", icon: Target, labelKey: "currentState" },
  { id: "progress", icon: BookOpen, labelKey: "progress" },
  { id: "ai", icon: Robot, labelKey: "aiGuide" },
  { id: "collaboration", icon: ChatTeardropText, labelKey: "collaboration" },
] as const;

type StudentMembershipCourseResponse = {
  courses?: Array<{
    courseId?: string;
    courseName?: string;
    semester?: string;
  }>;
  classes?: Array<{
    classId?: string;
    courseId?: string;
    className?: string;
    semester?: string;
  }>;
  memberships?: Array<{
    membershipId?: string;
    courseId?: string;
    classId?: string;
    membershipStatus?: string;
    joinedAt?: string;
    approvedAt?: string;
  }>;
};

type StudentClassMembershipItem = {
  id: string;
  courseId: string;
  classId: string;
  courseName: string;
  className: string;
  semester: string;
  membershipStatus: "approved" | "pending-teacher-review";
};

export function StudentDashboardPage() {
  const { locale } = useAppPreferences();
  const t = dashboardCopy[locale];
  const [classMemberships, setClassMemberships] = useState<StudentClassMembershipItem[]>([]);
  const activeCourse = learningCourses[0];
  const nextCourse = learningCourses[1];
  const recommendedCourse = plazaCourses[0];
  const latestGroupMessage =
    chatMessages.find((message) => message.kind === "student") ?? chatMessages[0];

  useEffect(() => {
    if (!shouldLoadStudentClassMemberships() || typeof fetch !== "function") {
      return;
    }

    let isCancelled = false;

    async function loadStudentClassMemberships() {
      try {
        const response = await fetch("/api/teaching/courses", {
          method: "GET",
          headers: { accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as
          | StudentMembershipCourseResponse
          | null;
        if (isCancelled || !response.ok || !body) {
          return;
        }

        setClassMemberships(createStudentClassMembershipItems(body));
      } catch {
        // Keep the static learning dashboard usable if the signed student read is unavailable.
      }
    }

    void loadStudentClassMemberships();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6" data-uais-student-dashboard>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_var(--shadow)] md:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">
              {locale === "zh-CN" ? "我的学习首页" : "Peter's learning home"}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
              {t.title}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--muted)]">
              {t.summary}
            </p>
          </div>
          <nav
            aria-label={t.quickActions}
            className="flex flex-wrap gap-2"
          >
            <DashboardAction
              href="/learning"
              label={t.continueLearning}
              icon={ArrowRight}
              detail={locale === "zh-CN" ? "已连接入口" : "/learning"}
            />
            <DashboardAction
              href="/learning/chatroom"
              label={t.openChatroom}
              icon={ChatTeardropText}
              variant="soft"
              detail={locale === "zh-CN" ? "已连接入口" : "/learning/chatroom"}
            />
            <DashboardAction
              href="/courses"
              label={t.browseCourses}
              icon={Compass}
              variant="soft"
              detail={locale === "zh-CN" ? "已连接入口" : "/courses"}
            />
          </nav>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_18px_42px_var(--shadow)]"
          data-uais-student-dashboard-sidebar
        >
          <h2 className="px-2 text-sm font-semibold text-[var(--muted)]">
            {t.sidebarTitle}
          </h2>
          <div className="mt-3 space-y-2">
            {sidebarItems.map((item, index) => {
              const Icon = item.icon;
              const active = index === 0;
              return (
                <a
                  key={item.id}
                  href={`#student-${item.id}`}
                  className={[
                    "flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    active
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-soft)]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex size-9 shrink-0 items-center justify-center rounded-2xl",
                      active
                        ? "bg-[var(--surface)] text-[var(--accent)]"
                        : "bg-[var(--accent-soft)] text-[var(--foreground)]",
                    ].join(" ")}
                  >
                    <Icon size={18} weight="duotone" />
                  </span>
                  <span
                    className={[
                      "block text-base font-semibold",
                      active ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                    ].join(" ")}
                  >
                    {t[item.labelKey]}
                  </span>
                </a>
              );
            })}
          </div>
        </aside>

        <div
          className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_42px_var(--shadow)]"
          data-uais-student-dashboard-main
        >
          <section
            id="student-state"
            className="grid gap-3 md:grid-cols-3"
            aria-label={t.currentState}
          >
            <MetricCard
              icon={CheckCircle}
              label={t.status}
              value="2"
              note={t.statusNote}
              tone="green"
            />
            <MetricCard
              icon={ClockCountdown}
              label={t.nextTask}
              value={locale === "zh-CN" ? "今天" : "Today"}
              note={t.nextTaskNote}
              tone="amber"
            />
            <MetricCard
              icon={Sparkle}
              label={t.aiReady}
              value={String(aiAgents.length)}
              note={t.aiReadyNote}
              tone="violet"
            />
          </section>

          <section
            id="student-progress"
            className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"
          >
            <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <GraduationCap size={23} weight="duotone" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--accent)]">
                    {t.learningSnapshot}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                    {localizedText(activeCourse.title, locale)}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                    {localizedText(activeCourse.progress, locale)}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <InfoPanel
                  label={t.activeCourse}
                  value={localizedText(activeCourse.currentUnit, locale)}
                  note={localizedText(activeCourse.focus, locale)}
                />
                <InfoPanel
                  label={t.unitFocus}
                  value={localizedText(nextCourse.title, locale)}
                  note={localizedText(nextCourse.focus, locale)}
                />
              </div>
            </article>

            {classMemberships.length > 0 ? (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">
                  {t.classMemberships}
                </h2>
                <div className="mt-4 space-y-3">
                  {classMemberships.map((membership) => (
                    <article
                      key={membership.id}
                      data-testid={`student-membership-${membership.id}`}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[var(--accent)]">
                            {membership.courseName}
                          </p>
                          <h3 className="mt-1 text-base font-semibold text-[var(--foreground)]">
                            {membership.className}
                          </h3>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {membership.semester}
                          </p>
                        </div>
                        <span
                          className={[
                            "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-semibold",
                            membership.membershipStatus === "approved"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
                          ].join(" ")}
                        >
                          {membership.membershipStatus === "approved"
                            ? t.approvedMembership
                            : t.pendingMembership}
                        </span>
                      </div>
                      {membership.membershipStatus === "approved" ? (
                        <Link
                          href={createStudentMembershipLearningHref(membership)}
                          className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-[var(--accent)] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-soft)]"
                        >
                          <ArrowRight size={16} weight="bold" />
                          {t.continueLearning}
                        </Link>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <aside
              id="student-ai"
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5"
            >
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {t.aiGuideTitle}
              </h2>
              <div className="mt-4 space-y-3">
                {aiAgents.slice(0, 3).map((agent) => (
                  <p
                    key={agent.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-3 text-sm leading-6 text-[var(--muted)]"
                  >
                    <span className="font-semibold text-[var(--foreground)]">
                      {localizedText(agent.name, locale)}
                    </span>
                    <span className="ml-2">{localizedText(agent.specialty, locale)}</span>
                  </p>
                ))}
              </div>
            </aside>
          </section>

          <section
            id="student-collaboration"
            className="grid gap-5 xl:grid-cols-2"
          >
            <StudentWorkflowCard
              icon={ChatTeardropText}
              title={t.chatTitle}
              label={t.groupSignal}
              body={localizedText(latestGroupMessage.text, locale)}
              href="/learning/chatroom"
              hrefLabel={t.openChatroom}
            />
            <StudentWorkflowCard
              icon={Notebook}
              title={t.plazaTitle}
              label={t.courseOpportunity}
              body={localizedText(recommendedCourse.description, locale)}
              href="/courses"
              hrefLabel={t.browseCourses}
            />
          </section>
        </div>
      </section>
    </div>
  );
}

function shouldLoadStudentClassMemberships() {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.location.pathname === "/student-dashboard" ||
    window.location.pathname === "/student-dashboard/"
  );
}

function createStudentClassMembershipItems(
  response: StudentMembershipCourseResponse,
): StudentClassMembershipItem[] {
  const coursesById = new Map(
    (response.courses ?? [])
      .map((course) => {
        const courseId = course.courseId?.trim();
        const courseName = course.courseName?.trim();
        if (!courseId || !courseName) {
          return undefined;
        }
        return [
          courseId,
          {
            courseName,
            semester: course.semester?.trim() ?? "",
          },
        ] as const;
      })
      .filter((course): course is readonly [string, { courseName: string; semester: string }] =>
        Boolean(course),
      ),
  );
  const classesById = new Map(
    (response.classes ?? [])
      .map((classItem) => {
        const classId = classItem.classId?.trim();
        const courseId = classItem.courseId?.trim();
        const className = classItem.className?.trim();
        if (!classId || !courseId || !className) {
          return undefined;
        }
        return [
          classId,
          {
            courseId,
            className,
            semester: classItem.semester?.trim() ?? "",
          },
        ] as const;
      })
      .filter(
        (
          classItem,
        ): classItem is readonly [
          string,
          { courseId: string; className: string; semester: string },
        ] => Boolean(classItem),
      ),
  );

  return (response.memberships ?? [])
    .map((membership) => {
      const membershipId = membership.membershipId?.trim();
      const classId = membership.classId?.trim();
      if (!membershipId || !classId) {
        return undefined;
      }
      const classItem = classesById.get(classId);
      if (!classItem) {
        return undefined;
      }
      const course = coursesById.get(classItem.courseId);
      if (!course) {
        return undefined;
      }

      return {
        id: membershipId,
        courseId: classItem.courseId,
        classId,
        courseName: course.courseName,
        className: classItem.className,
        semester: classItem.semester || course.semester,
        membershipStatus:
          membership.membershipStatus === "approved" ? "approved" : "pending-teacher-review",
      } satisfies StudentClassMembershipItem;
    })
    .filter((membership): membership is StudentClassMembershipItem => Boolean(membership));
}

function createStudentMembershipLearningHref(membership: StudentClassMembershipItem) {
  const params = new URLSearchParams({
    courseId: membership.courseId,
    classId: membership.classId,
  });
  return `/learning?${params.toString()}`;
}

function DashboardAction({
  href,
  detail,
  icon: Icon,
  label,
  variant = "primary",
}: {
  href: string;
  detail: string;
  icon: typeof ArrowRight;
  label: string;
  variant?: "primary" | "soft";
}) {
  return (
    <Link
      href={href}
      className={[
        "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
        variant === "primary"
          ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]"
          : "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-soft)]",
      ].join(" ")}
    >
      <Icon size={17} weight="bold" />
      <span>{label}</span>
      <span className="text-[11px] font-semibold opacity-70">{detail}</span>
    </Link>
  );
}

function MetricCard({
  icon: Icon,
  label,
  note,
  tone,
  value,
}: {
  icon: typeof CheckCircle;
  label: string;
  note: string;
  tone: "green" | "amber" | "violet";
  value: string;
}) {
  const toneClass = {
    amber: {
      border: "border-t-[#d97706]",
      icon: "bg-[#fef3c7] text-[#a16207] dark:bg-[#3a2a12] dark:text-[#fbbf24]",
    },
    green: {
      border: "border-t-[#16a34a]",
      icon: "bg-[#dcfce7] text-[#166534] dark:bg-[#14331f] dark:text-[#86efac]",
    },
    violet: {
      border: "border-t-[#7c3aed]",
      icon: "bg-[#ede9fe] text-[#6d28d9] dark:bg-[#2e234c] dark:text-[#c4b5fd]",
    },
  }[tone];

  return (
    <article
      className={[
        "rounded-2xl border border-t-4 border-[var(--border)] bg-[var(--surface-elevated)] p-4",
        toneClass.border,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</p>
        <span
          className={[
            "flex size-9 shrink-0 items-center justify-center rounded-2xl",
            toneClass.icon,
          ].join(" ")}
        >
          <Icon size={18} weight="duotone" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{note}</p>
    </article>
  );
}

function InfoPanel({
  label,
  note,
  value,
}: {
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
      <p className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-base font-semibold text-[var(--foreground)]">{value}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{note}</p>
    </div>
  );
}

function StudentWorkflowCard({
  body,
  href,
  hrefLabel,
  icon: Icon,
  label,
  title,
}: {
  body: string;
  href: string;
  hrefLabel: string;
  icon: typeof ChatTeardropText;
  label: string;
  title: string;
}) {
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon size={22} weight="duotone" />
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">{label}</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
            {title}
          </h2>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{body}</p>
      <Link
        href={href}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface-soft)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {hrefLabel}
        <ArrowRight size={16} weight="bold" />
      </Link>
    </article>
  );
}
