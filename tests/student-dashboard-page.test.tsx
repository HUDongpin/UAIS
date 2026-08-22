import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentDashboardPage } from "@/components/pages/student-dashboard-page";
import { SessionUserProvider } from "@/components/providers/session-user";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Read at render time, not at factory time, so a case can switch locale the way
// header.test.tsx switches pathname.
let mockLocale: "zh-CN" | "en-US" = "zh-CN";

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: mockLocale,
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

afterEach(() => {
  window.history.replaceState(null, "", "/");
  mockLocale = "zh-CN";
  vi.restoreAllMocks();
});

describe("StudentDashboardPage", () => {
  it("creates a student dashboard consistent with the teaching workspace language", () => {
    const { container } = render(<StudentDashboardPage />);

    expect(screen.getByRole("heading", { name: "学生看板" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "我的教学" })).toBeNull();
    expect(container.querySelector("[data-uais-student-dashboard]")).toBeTruthy();
    expect(container.querySelector("[data-uais-student-dashboard-sidebar]")).toBeTruthy();
    expect(container.querySelector("[data-uais-student-dashboard-main]")).toBeTruthy();
    expect(
      container
        .querySelector("[data-uais-student-dashboard-main]")
        ?.className,
    ).toContain("shadow-[0_18px_42px_var(--shadow)]");
  });

  it("surfaces current UAIS student workflows from learning, courses, and chat", () => {
    render(<StudentDashboardPage />);

    expect(screen.getByText("今日学习状态")).toBeTruthy();
    expect(screen.getByText("智能导学")).toBeTruthy();
    expect(screen.getByText("人机协作聊天室")).toBeTruthy();
    expect(screen.getByText("课程广场")).toBeTruthy();

    const actions = screen.getByRole("navigation", { name: "学生看板快捷入口" });
    // E14/PKG-8b: the hero CTA used to be "继续学习 → /learning" for everyone.
    // Bare /learning resolves to the template's demo course id, which the
    // playback route refuses, so a student with no approved class clicked
    // "continue learning" straight into a 403. With no membership to continue,
    // it now offers the page where a class can actually be joined.
    expect(
      within(actions)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["加入课程已连接入口", "/courses"],
      ["进入聊天室已连接入口", "/learning/chatroom"],
      ["浏览课程已连接入口", "/courses"],
    ]);
  });

  it("points the hero continue action at the first approved membership", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          courses: [
            {
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              courseName: "AI Supported Mathematics Research",
              semester: "2026 Spring",
            },
          ],
          classes: [
            {
              classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              className: "Research Methods Class 1",
              semester: "2026 Spring",
            },
          ],
          memberships: [
            {
              membershipId: "membership-pending",
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
              membershipStatus: "pending-teacher-review",
            },
            {
              membershipId: "membership-approved",
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
              membershipStatus: "approved",
            },
          ],
        }),
      ),
    );

    render(<StudentDashboardPage />);

    const actions = screen.getByRole("navigation", { name: "学生看板快捷入口" });
    const heroAction = await waitFor(() => {
      const link = within(actions).getByRole("link", { name: /继续学习/ });
      expect(link.getAttribute("href")).toBe(
        "/learning?courseId=teacher-course-ai-supported-mathematics-research-20260622-112000&classId=teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
      );
      return link;
    });
    // A pending membership is not a workspace the student can enter, so the
    // approved one is what the CTA points at even when it is listed second.
    expect(heroAction.getAttribute("href")).not.toBe("/learning");
    expect(within(actions).queryByRole("link", { name: /加入课程/ })).toBeNull();
  });

  it("loads the signed student's invite-code class memberships", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ accept: "application/json" });

      return Response.json({
        courses: [
          {
            courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
            courseName: "AI Supported Mathematics Research",
            semester: "2026 Spring",
          },
          {
            courseId: "teacher-course-statistics-writing-20260622-112000",
            courseName: "Statistics Writing Studio",
            semester: "2026 Spring",
          },
        ],
        classes: [
          {
            classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
            courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
            className: "Research Methods Class 1",
            semester: "2026 Spring",
            invitationCode: "55395057",
          },
          {
            classId: "teacher-course-statistics-writing-20260622-112000-class-1",
            courseId: "teacher-course-statistics-writing-20260622-112000",
            className: "Statistics Writing Cohort",
            semester: "2026 Spring",
            invitationCode: "66334455",
          },
        ],
        memberships: [
          {
            membershipId:
              "membership-teacher-course-ai-supported-mathematics-research-20260622-112000-class-1-Peter",
            courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
            classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
            studentId: "Peter",
            studentDisplayName: "Peter",
            membershipStatus: "approved",
            joinedAt: "2026-06-22T11:40:00.000Z",
            approvedAt: "2026-06-22T11:45:00.000Z",
          },
          {
            membershipId:
              "membership-teacher-course-statistics-writing-20260622-112000-class-1-Peter",
            courseId: "teacher-course-statistics-writing-20260622-112000",
            classId: "teacher-course-statistics-writing-20260622-112000-class-1",
            studentId: "Peter",
            studentDisplayName: "Peter",
            membershipStatus: "pending-teacher-review",
            joinedAt: "2026-06-22T11:42:00.000Z",
          },
        ],
        receipt: {
          action: "list-student-courses",
          actorId: "Peter",
          status: "read",
          responsibleSession: "S12",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StudentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("班级加入状态")).toBeTruthy();
      expect(screen.getByText("AI Supported Mathematics Research")).toBeTruthy();
      expect(screen.getByText("Research Methods Class 1")).toBeTruthy();
      expect(screen.getByText("已加入")).toBeTruthy();
      expect(screen.getByText("Statistics Writing Cohort")).toBeTruthy();
      expect(screen.getByText("等待教师审批")).toBeTruthy();
    });
  });

  it("links approved invite-code memberships into the learning workspace", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          courses: [
            {
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              courseName: "AI Supported Mathematics Research",
              semester: "2026 Spring",
            },
            {
              courseId: "teacher-course-statistics-writing-20260622-112000",
              courseName: "Statistics Writing Studio",
              semester: "2026 Spring",
            },
          ],
          classes: [
            {
              classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              className: "Research Methods Class 1",
              semester: "2026 Spring",
            },
            {
              classId: "teacher-course-statistics-writing-20260622-112000-class-1",
              courseId: "teacher-course-statistics-writing-20260622-112000",
              className: "Statistics Writing Cohort",
              semester: "2026 Spring",
            },
          ],
          memberships: [
            {
              membershipId:
                "membership-teacher-course-ai-supported-mathematics-research-20260622-112000-class-1-Peter",
              courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
              classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "approved",
            },
            {
              membershipId:
                "membership-teacher-course-statistics-writing-20260622-112000-class-1-Peter",
              courseId: "teacher-course-statistics-writing-20260622-112000",
              classId: "teacher-course-statistics-writing-20260622-112000-class-1",
              studentId: "Peter",
              studentDisplayName: "Peter",
              membershipStatus: "pending-teacher-review",
            },
          ],
        }),
      ),
    );

    render(<StudentDashboardPage />);

    const approvedCard = await screen.findByTestId(
      "student-membership-membership-teacher-course-ai-supported-mathematics-research-20260622-112000-class-1-Peter",
    );
    const pendingCard = await screen.findByTestId(
      "student-membership-membership-teacher-course-statistics-writing-20260622-112000-class-1-Peter",
    );

    expect(within(approvedCard).getByRole("link", { name: "继续学习" }).getAttribute("href")).toBe(
      "/learning?courseId=teacher-course-ai-supported-mathematics-research-20260622-112000&classId=teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
    );
    expect(within(pendingCard).queryByRole("link", { name: "继续学习" })).toBeNull();
  });

  // E12/PKG-7: a refused read used to be swallowed, so an expired session was
  // shown the template's demo dashboard as if those were its own courses.
  it.each([401, 403])(
    "replaces the dashboard with a signed-out state and a /login handoff on %i",
    async (status) => {
      window.history.replaceState(null, "", "/student-dashboard");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ error: "signed out" }, { status })),
      );

      const { container } = render(<StudentDashboardPage />);

      await waitFor(() => {
        expect(
          container.querySelector("[data-uais-student-dashboard-signed-out]"),
        ).toBeTruthy();
      });
      expect(screen.getByText("登录状态已失效")).toBeTruthy();
      expect(
        screen.getByRole("link", { name: "重新登录" }).getAttribute("href"),
      ).toBe("/login?from=%2Fstudent-dashboard");
      // The demo dashboard must be gone, not merely covered.
      expect(screen.queryByText("今日学习状态")).toBeNull();
      expect(container.querySelector("[data-uais-student-dashboard-sidebar]")).toBeNull();
    },
  );

  it("keeps the dashboard up with a retry note when the courses read cannot be reached", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { container } = render(<StudentDashboardPage />);

    await waitFor(() => {
      expect(
        container.querySelector("[data-uais-student-dashboard-unreachable]"),
      ).toBeTruthy();
    });
    expect(
      container.querySelector("[data-uais-student-dashboard-unreachable]")
        ?.textContent,
    ).toContain("不会回退到演示进度");
    expect(screen.queryByText(/下面显示的是示例内容/)).toBeNull();
    expect(screen.getByText("今日学习状态")).toBeTruthy();
    expect(container.querySelector("[data-uais-student-dashboard-signed-out]")).toBeNull();
  });

  it("greets the signed-in learner by name in both locales, and nobody at all without a session", () => {
    // The English eyebrow was the hardcoded "Peter's learning home" - the demo
    // student's name printed over every real learner's dashboard - while the
    // Chinese one said nothing about who was reading. Both now read the session.
    const sessionUser = {
      account: "s2026001",
      role: "student" as const,
      displayName: "陈可",
      department: "教育学院",
    };

    const zh = render(
      <SessionUserProvider initialSessionUser={sessionUser}>
        <StudentDashboardPage />
      </SessionUserProvider>,
    );
    expect(screen.getByText("陈可的学习首页")).toBeTruthy();
    zh.unmount();

    mockLocale = "en-US";
    const en = render(
      <SessionUserProvider initialSessionUser={sessionUser}>
        <StudentDashboardPage />
      </SessionUserProvider>,
    );
    expect(screen.getByText("陈可's learning home")).toBeTruthy();
    expect(screen.queryByText("Peter's learning home")).toBeNull();
    en.unmount();

    // No session, no name. The fallback is first-person, never a persona.
    render(<StudentDashboardPage />);
    expect(screen.getByText("My learning home")).toBeTruthy();
    expect(screen.queryByText("Peter's learning home")).toBeNull();
  });

  it("keeps a declined or removed class on the list, with a reason and no way in", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          courses: [
            {
              courseId: "course-declined",
              courseName: "Statistics Writing Studio",
              semester: "2026 Spring",
            },
            {
              courseId: "course-removed",
              courseName: "Research Methods",
              semester: "2026 Spring",
            },
          ],
          classes: [
            {
              classId: "class-declined",
              courseId: "course-declined",
              className: "Writing Cohort",
              semester: "2026 Spring",
            },
            {
              classId: "class-removed",
              courseId: "course-removed",
              className: "Methods Class 1",
              semester: "2026 Spring",
            },
          ],
          memberships: [
            {
              membershipId: "membership-declined",
              courseId: "course-declined",
              classId: "class-declined",
              membershipStatus: "rejected",
              joinedAt: "2026-06-22T11:42:00.000Z",
            },
            {
              membershipId: "membership-removed",
              courseId: "course-removed",
              classId: "class-removed",
              membershipStatus: "removed",
              joinedAt: "2026-06-20T11:42:00.000Z",
            },
          ],
        }),
      ),
    );

    const { container } = render(<StudentDashboardPage />);

    // Both rows used to be filtered out of the response entirely, so the class
    // vanished from the dashboard and nothing anywhere said why.
    await waitFor(() => {
      expect(screen.getByText("教师未通过申请")).toBeTruthy();
    });
    expect(screen.getByText("已被移出班级")).toBeTruthy();
    expect(screen.getAllByText(/这个班级已不在你的学习列表中/).length).toBe(2);

    for (const membershipId of ["membership-declined", "membership-removed"]) {
      const row = container.querySelector(`[data-testid="student-membership-${membershipId}"]`);
      expect(row).toBeTruthy();
      // No entry link on a class the teacher closed: the old pending-row rule
      // ("links nowhere rather than to a 403") applies here for the same reason.
      expect(row?.querySelector("a")).toBeNull();
    }
    // And the hero CTA still offers joining rather than continuing, because a
    // closed membership is not an approved one.
    expect(screen.getByText("加入课程")).toBeTruthy();
  });
});
