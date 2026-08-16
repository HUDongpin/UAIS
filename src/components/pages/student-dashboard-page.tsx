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
import { UsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { useAppPreferences } from "@/components/providers/app-preferences";
import { useSessionUser } from "@/components/providers/session-user";
import { localizedText } from "@/components/ui/localized-text";
import { aiAgents, chatMessages, learningCourses, plazaCourses } from "@/data/uais";
import { copy } from "@/i18n/copy";
import type { Locale } from "@/i18n/copy";
import { createLoginHandoffHref } from "@/lib/auth/login-return-path";
import {
  createStudentClassMembershipItems,
  createStudentMembershipLearningHref,
  isClosedStudentMembership,
  type StudentClassMembershipItem,
  type StudentMembershipCourseResponse,
} from "./student-membership-helpers";

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
    // The hero action when the student has no approved class yet. "继续学习"
    // pointing at bare /learning opened the template's demo course id, which the
    // playback route then refuses - a 403 as the first thing a new student clicks.
    joinCourse: "加入课程",
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
    joinCourse: "Join a Course",
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

// The dashboard reads one field the plaza does not: the student projection of
// the teacher-owned learning groups - only groups the caller belongs to,
// co-members by display name only, self flagged server-side.
type StudentDashboardCourseResponse = StudentMembershipCourseResponse & {
  learningGroups?: Array<{
    groupId?: string;
    courseId?: string;
    classId?: string;
    groupName?: string;
    members?: Array<{
      displayName?: string;
      isSelf?: boolean;
    }>;
  }>;
};

type StudentLearningGroupItem = {
  groupId: string;
  courseId: string;
  groupName: string;
  members: Array<{ displayName: string; isSelf: boolean }>;
};

// What the signed-student read said about the session behind it. A refusal and
// an unreachable server are different facts and used to be the same silent
// `return`: an expired session was shown the demo dashboard as if it were the
// student's own courses.
type StudentDashboardSessionState = "ok" | "signed-out" | "unreachable";

const studentDashboardLoginHref = createLoginHandoffHref("/student-dashboard");

export function StudentDashboardPage() {
  const { locale } = useAppPreferences();
  const sessionUser = useSessionUser();
  const t = dashboardCopy[locale];
  const authCopy = copy[locale].auth;
  // The closed-membership wording lives with the plaza's membership copy, which
  // renders the same rows: one class leaving a student's list must not be
  // described in two different ways on two pages.
  const plazaCopy = copy[locale].coursePlaza;
  const [classMemberships, setClassMemberships] = useState<StudentClassMembershipItem[]>([]);
  const [learningGroups, setLearningGroups] = useState<StudentLearningGroupItem[]>([]);
  const [sessionState, setSessionState] = useState<StudentDashboardSessionState>("ok");
  const activeCourse = learningCourses[0];
  const nextCourse = learningCourses[1];
  const recommendedCourse = plazaCourses[0];
  const latestGroupMessage =
    chatMessages.find((message) => message.kind === "student") ?? chatMessages[0];
  const approvedMembership = classMemberships.find(
    (membership) => membership.membershipStatus === "approved",
  );
  const continueLearningHref = approvedMembership
    ? createStudentMembershipLearningHref(approvedMembership)
    : "/courses";
  const continueLearningDetail = approvedMembership ? "/learning" : "/courses";
  // The eyebrow above the dashboard title. The English copy was the hardcoded
  // "Peter's learning home" - the demo student's name, printed over every real
  // learner's dashboard - while the Chinese copy said nothing about who was
  // reading. Both locales now name the signed-in learner and both fall back to
  // the first person when the session carries no name; neither ever names
  // somebody else.
  const learnerDisplayName = sessionUser?.displayName?.trim();
  const learningHomeLabel = learnerDisplayName
    ? locale === "zh-CN"
      ? `${learnerDisplayName}的学习首页`
      : `${learnerDisplayName}'s learning home`
    : locale === "zh-CN"
      ? "我的学习首页"
      : "My learning home";

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
          | StudentDashboardCourseResponse
          | null;
        if (isCancelled) {
          return;
        }

        // A refused read means this browser is not (or no longer) a signed-in
        // student. Rendering the demo dashboard here would tell an expired
        // session that its courses and groups are fine.
        if (response.status === 401 || response.status === 403) {
          setSessionState("signed-out");
          return;
        }
        if (!response.ok || !body) {
          setSessionState("unreachable");
          return;
        }

        setSessionState("ok");
        setClassMemberships(createStudentClassMembershipItems(body));
        setLearningGroups(createStudentLearningGroupItems(body));
      } catch {
        // Reachability, not authorization: the dashboard stays up and says so.
        if (!isCancelled) {
          setSessionState("unreachable");
        }
      }
    }

    void loadStudentClassMemberships();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (sessionState === "signed-out") {
    return (
      <div className="space-y-6" data-uais-student-dashboard>
        <section
          data-uais-student-dashboard-signed-out="true"
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_var(--shadow)] md:p-7"
        >
          <p className="text-sm font-semibold text-[var(--accent)]">{t.title}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
            {authCopy.sessionExpiredTitle}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
            {authCopy.sessionExpiredBody}
          </p>
          <Link
            href={studentDashboardLoginHref}
            data-uais-student-dashboard-sign-in="true"
            className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
          >
            <ArrowRight size={17} weight="bold" />
            {authCopy.signIn}
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-uais-student-dashboard>
      {/* Reachability only: the courses below are the template's own sample
          content, and the read that would have replaced them can be retried. */}
      {sessionState === "unreachable" ? (
        <p
          data-uais-student-dashboard-unreachable="true"
          role="status"
          className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-sm leading-6 text-[var(--muted)]"
        >
          {authCopy.networkRetry}
        </p>
      ) : null}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_18px_48px_var(--shadow)] md:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--accent)]">
              {learningHomeLabel}
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
            {/* The one CTA a student is most likely to press, and it used to
                point at bare /learning - which resolves to the template's demo
                course id and is refused for a real student. It now opens the
                first class the teacher actually approved, or, when there is
                none yet, the page where a class can be joined. */}
            <DashboardAction
              href={continueLearningHref}
              label={approvedMembership ? t.continueLearning : t.joinCourse}
              icon={ArrowRight}
              detail={locale === "zh-CN" ? "已连接入口" : continueLearningDetail}
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
                          data-uais-student-membership-status={membership.membershipStatus}
                          className={[
                            "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-sm font-semibold",
                            membership.membershipStatus === "approved"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                              : isClosedStudentMembership(membership)
                                ? "bg-[var(--surface)] text-[var(--muted)]"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200",
                          ].join(" ")}
                        >
                          {membership.membershipStatus === "approved"
                            ? t.approvedMembership
                            : membership.membershipStatus === "rejected"
                              ? plazaCopy.membershipRejected
                              : membership.membershipStatus === "removed"
                                ? plazaCopy.membershipRemoved
                                : t.pendingMembership}
                        </span>
                      </div>
                      {/* A class that left the list says so, quietly, in place
                          of the entry link it no longer has. Without this the
                          class simply vanished and the student had nothing to
                          read anywhere. */}
                      {isClosedStudentMembership(membership) ? (
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                          {plazaCopy.membershipClosedNote}
                        </p>
                      ) : null}
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
            {learningGroups.length > 0 ? (
              <StudentGroupSignalCard
                groups={learningGroups}
                label={t.groupSignal}
                locale={locale}
              />
            ) : (
              <StudentWorkflowCard
                icon={ChatTeardropText}
                title={t.chatTitle}
                label={t.groupSignal}
                body={localizedText(latestGroupMessage.text, locale)}
                href="/learning/chatroom"
                hrefLabel={t.openChatroom}
              />
            )}
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

function createStudentLearningGroupItems(
  response: StudentDashboardCourseResponse,
): StudentLearningGroupItem[] {
  return (response.learningGroups ?? [])
    .map((group) => {
      const groupId = group.groupId?.trim();
      const courseId = group.courseId?.trim();
      const groupName = group.groupName?.trim();
      if (!groupId || !courseId || !groupName) {
        return undefined;
      }

      return {
        groupId,
        courseId,
        groupName,
        members: (group.members ?? [])
          .map((member) => {
            const displayName = member.displayName?.trim();
            if (!displayName) {
              return undefined;
            }
            return { displayName, isSelf: member.isSelf === true };
          })
          .filter((member): member is { displayName: string; isSelf: boolean } =>
            Boolean(member),
          ),
      } satisfies StudentLearningGroupItem;
    })
    .filter((group): group is StudentLearningGroupItem => Boolean(group));
}

// `?groupId=` alone resolves the room server-side (the group record carries its
// own course/class); `courseId` rides along as a harmless readability hint.
export function createStudentLearningGroupChatroomHref(group: {
  courseId: string;
  groupId: string;
}) {
  const params = new URLSearchParams({
    courseId: group.courseId,
    groupId: group.groupId,
  });
  return `/learning/chatroom?${params.toString()}`;
}

function StudentGroupSignalCard({
  groups,
  label,
  locale,
}: {
  groups: StudentLearningGroupItem[];
  label: string;
  locale: Locale;
}) {
  const t = copy[locale].learning;

  return (
    <article
      data-uais-student-group-signal
      className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <UsersThree size={22} weight="duotone" />
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">{label}</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
            {t.groupCardTitle}
          </h2>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div
            key={group.groupId}
            data-uais-student-group={group.groupId}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-3"
          >
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              {group.groupName}
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label={t.groupMembers}>
              {group.members.map((member) => (
                <li
                  key={`${group.groupId}-${member.displayName}`}
                  className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm font-medium text-[var(--foreground)]"
                >
                  {member.isSelf
                    ? locale === "zh-CN"
                      ? `${member.displayName}（${t.groupYou}）`
                      : `${member.displayName} (${t.groupYou})`
                    : member.displayName}
                </li>
              ))}
            </ul>
            <Link
              href={createStudentLearningGroupChatroomHref(group)}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-[var(--accent)] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-soft)]"
            >
              <ChatTeardropText size={16} weight="bold" />
              {t.openChatroom}
            </Link>
          </div>
        ))}
      </div>
    </article>
  );
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
