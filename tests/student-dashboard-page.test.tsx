import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentDashboardPage } from "@/components/pages/student-dashboard-page";

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

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: "zh-CN",
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

afterEach(() => {
  window.history.replaceState(null, "", "/");
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
    expect(
      within(actions)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["继续学习已连接入口", "/learning"],
      ["进入聊天室已连接入口", "/learning/chatroom"],
      ["浏览课程已连接入口", "/courses"],
    ]);
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
});
