import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoursePlazaPage } from "@/components/pages/course-plaza-page";

const mockPreferences = vi.hoisted(() => ({
  locale: "zh-CN" as "zh-CN" | "en-US",
}));

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
    locale: mockPreferences.locale,
  }),
}));

afterEach(() => {
  mockPreferences.locale = "zh-CN";
  window.history.replaceState(null, "", "/");
});

describe("CoursePlazaPage", () => {
  it("does not show the personal teaching template label", () => {
    render(<CoursePlazaPage />);

    expect(screen.queryByText("个人教学模板")).toBeNull();
  });

  it("does not show the course plaza summary sentence", () => {
    render(<CoursePlazaPage />);

    expect(
      screen.queryByText("选择课程，进入清晰、节制、可继续扩展的大学课堂学习空间。"),
    ).toBeNull();
  });

  it("does not show the website subtitle beside the course plaza brand card", () => {
    render(<CoursePlazaPage />);

    expect(screen.queryByText("优爱思官网")).toBeNull();

    cleanup();
    mockPreferences.locale = "en-US";
    render(<CoursePlazaPage />);

    expect(document.body.textContent).not.toContain("uais.top");
  });

  it("shows Prof. Kang on the left card and Prof. Wu on the right card", () => {
    render(<CoursePlazaPage />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "数学教学法",
      "大学研究方法",
    ]);
    expect(screen.getAllByText(/^授课教师：/).map((teacher) => teacher.textContent)).toEqual([
      "授课教师：康霞老师",
      "授课教师：吴亚军老师",
    ]);
  });

  it("shows a unit progress bar for each course card", () => {
    render(<CoursePlazaPage />);

    const progressBars = screen.getAllByRole("progressbar");

    expect(progressBars).toHaveLength(2);
    progressBars.forEach((progressBar) => {
      expect(progressBar.getAttribute("aria-valuemin")).toBe("0");
      expect(progressBar.getAttribute("aria-valuemax")).toBe("12");
      expect(progressBar.getAttribute("aria-valuenow")).toBe("1");
      expect(progressBar.textContent).toContain("8%");
    });
  });

  it("links each course Enter Learning action to its matching learning workspace", () => {
    render(<CoursePlazaPage />);

    const enterLearningLinks = screen.getAllByRole("link", { name: "进入学习" });

    expect(enterLearningLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/learning?courseId=math-pedagogy-learning",
      "/learning?courseId=research-methods-learning",
    ]);
  });

  it("lets a signed-in student submit an invite-code join request from the plaza", async () => {
    window.history.replaceState(null, "", "/courses?invite=66334455");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/invite-codes/66334455/join");
      expect(init?.method).toBe("POST");
      return Response.json(
        {
          membership: {
            membershipId: "membership-class-1-Peter",
            courseId: "teacher-course-enterprise-operations-20260623",
            classId: "teacher-course-enterprise-operations-20260623-class-1",
            invitationCode: "66334455",
            studentId: "Peter",
            studentDisplayName: "Peter",
            membershipStatus: "pending-teacher-review",
            joinedAt: "2026-06-25T06:45:00.000Z",
          },
          receipt: {
            action: "join-class-by-invite",
            actorId: "Peter",
            status: "persisted",
            responsibleSession: "S12",
          },
          redaction: {
            secrets: "omitted",
            localFiles: "omitted",
            assets: "ids-only",
          },
        },
        {
          status: 201,
          headers: { "x-uais-trace-id": "trace-student-invite-join" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CoursePlazaPage />);

    await waitFor(() => {
      expect(screen.getByText("邀请码：66334455")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "申请加入班级" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/teaching/invite-codes/66334455/join",
        expect.objectContaining({ method: "POST" }),
      );
      expect(
        screen.getByText("加入申请已提交，等待教师审批。追踪编号：trace-student-invite-join"),
      ).toBeTruthy();
    });
    expect(screen.queryByText("加入申请已提交，已直接加入班级。")).toBeNull();
  });

  it("surfaces invalid invite-code links instead of silently hiding the join request", () => {
    window.history.replaceState(null, "", "/courses?invite=../secret-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CoursePlazaPage />);

    expect(screen.getByRole("alert").textContent).toContain(
      "邀请码链接无效，请检查链接或向教师确认。",
    );
    expect(document.body.textContent).not.toContain("../secret-token");
    expect(screen.queryByRole("button", { name: "申请加入班级" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
