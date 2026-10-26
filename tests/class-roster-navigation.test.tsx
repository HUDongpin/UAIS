import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeachingPage } from "@/components/pages/teaching-page";
import {
  clearClassRosterFragment,
  getClassRosterHref,
  openSamePageClassRoster,
} from "@/lib/teaching/class-roster-navigation";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({ locale: "zh-CN", theme: "light" }),
}));

const scrollIntoView = vi.fn();

function courseListResponse() {
  return Response.json({
    courses: [
      {
        courseId: "course-roster",
        courseName: "通知导航课程",
        instructor: "测试教师",
        unit: "测试大学",
        department: "教学部",
        semester: "2026 秋季",
        students: 2,
      },
    ],
    classes: ["class-a", "班级 b"].map((classId) => ({
      classId,
      courseId: "course-roster",
      className: classId,
      students: 1,
      semester: "2026 秋季",
      invitationCode: "12345678",
    })),
    memberships: ["class-a", "班级 b"].map((classId) => ({
      membershipId: `membership-${classId}`,
      courseId: "course-roster",
      classId,
      invitationCode: "12345678",
      studentId: `student-${classId}`,
      studentDisplayName: `学生 ${classId}`,
      membershipStatus: "pending-teacher-review",
      joinedAt: "2026-10-20T00:00:00.000Z",
    })),
    receipt: {
      action: "list-courses",
      actorId: "teacher-navigation",
      status: "read",
    },
  });
}

beforeEach(() => {
  scrollIntoView.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/teaching/courses/course-roster/lessons")
        return Response.json({
          lessons: [],
          classes: [
            { externalId: "class-a", name: "class-a" },
            { externalId: "班级 b", name: "班级 b" },
          ],
        });
      if (path === "/api/teaching/courses/course-roster/retention")
        return Response.json({
          retention: {
            courseId: "course-roster",
            retentionDays: 180,
            closedAt: null,
            purgeAfter: null,
            purgedAt: null,
            eligibleForPurge: false,
            counts: {},
            confirmationDigest: "test",
          },
        });
      if (path.includes("/classes/") && path.endsWith("/roster"))
        return Response.json(
          { reasonCode: "classroom-roster-database-required" },
          { status: 503 },
        );
      expect(String(input)).toBe("/api/teaching/courses");
      return courseListResponse();
    }),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  window.history.replaceState({ preserved: "next-history" }, "", "/teaching");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("class roster notification navigation", () => {
  it("focuses the exact class roster after the course readback arrives", async () => {
    window.history.replaceState(
      null,
      "",
      "/teaching#uais-class-roster-%E7%8F%AD%E7%BA%A7%20b",
    );
    const { container } = render(<TeachingPage />);
    await screen.findByText("学生 班级 b 等待加入");
    const target = container.querySelector('[data-uais-class-roster="班级 b"]');

    expect(target?.id).toBe("uais-class-roster-班级 b");
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(scrollIntoView.mock.instances).toEqual([target]);
  });

  it("keeps one canonical roster anchor while the classroom student tab is open", async () => {
    const { container } = render(<TeachingPage />);
    await screen.findByText("学生 class-a 等待加入");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "学生与班级" }));
    });
    expect(
      container.querySelectorAll('[data-uais-class-roster="class-a"]'),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "查看与审批名单" }));
    const target = container.querySelector(
      '[data-uais-class-roster="class-a"]',
    );
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(target?.closest("details")?.open).toBe(true);
  });

  it("reveals the roster workspace when a notification fragment arrives on the teaching page", async () => {
    const { container } = render(<TeachingPage />);
    await screen.findByText("学生 class-a 等待加入");
    fireEvent.click(screen.getByRole("link", { name: "课程内容" }));
    expect(
      container.querySelector('[data-uais-class-roster="class-a"]'),
    ).toBeNull();

    act(() => {
      window.history.pushState(
        window.history.state,
        "",
        "/teaching#uais-class-roster-class-a",
      );
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    const target = container.querySelector(
      '[data-uais-class-roster="class-a"]',
    );
    expect(target).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(
      screen
        .getByRole("link", { name: "课程设置" })
        .getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("link", { name: "课程内容" }));
    expect(window.location.hash).toBe("");
    expect(window.history.state).toEqual({ preserved: "next-history" });
    expect(
      container.querySelector(
        '[data-uais-active-teaching-workspace="content"]',
      ),
    ).not.toBeNull();
  });

  it("responds to browser history navigation between exact roster targets", async () => {
    const { container } = render(<TeachingPage />);
    await screen.findByText("学生 class-a 等待加入");

    for (const classId of ["class-a", "班级 b"]) {
      act(() => {
        window.history.replaceState(
          null,
          "",
          `/teaching#${encodeURIComponent(`uais-class-roster-${classId}`)}`,
        );
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(document.activeElement).toBe(
        container.querySelector(`[data-uais-class-roster="${classId}"]`),
      );
    }
  });

  it("reopens the roster from a notification link and refocuses repeated clicks without adding history", async () => {
    const { container } = render(<TeachingPage />);
    await screen.findByText("学生 class-a 等待加入");
    fireEvent.click(screen.getByRole("link", { name: "课程内容" }));

    act(() => {
      expect(openSamePageClassRoster(getClassRosterHref("班级 b"))).toBe(true);
    });
    const target = container.querySelector('[data-uais-class-roster="班级 b"]');
    expect(document.activeElement).toBe(target);
    expect(window.history.state).toEqual({ preserved: "next-history" });
    const historyLength = window.history.length;
    const coursePicker = screen.getByLabelText("工作台操作课程");
    coursePicker.focus();

    act(() => {
      expect(openSamePageClassRoster(getClassRosterHref("班级 b"))).toBe(true);
    });
    expect(document.activeElement).toBe(target);
    expect(window.history.length).toBe(historyLength);
  });

  it("leaves cross-page and external links to normal browser navigation", () => {
    const initialUrl = window.location.href;
    expect(openSamePageClassRoster("/teaching#other-section")).toBe(false);
    expect(openSamePageClassRoster("/teaching#uais-class-roster-")).toBe(false);
    expect(openSamePageClassRoster("/courses#uais-class-roster-class-a")).toBe(
      false,
    );
    expect(
      openSamePageClassRoster(
        "https://example.com/teaching#uais-class-roster-class-a",
      ),
    ).toBe(false);
    expect(window.location.href).toBe(initialUrl);

    window.history.replaceState(null, "", "/courses");
    expect(openSamePageClassRoster(getClassRosterHref("class-a"))).toBe(false);
    expect(window.location.pathname).toBe("/courses");
  });

  it("preserves the current query and history state when opening and leaving a roster", () => {
    window.history.replaceState(
      { preserved: "next-history" },
      "",
      "/teaching?view=owned#other-section",
    );
    clearClassRosterFragment();
    expect(window.location.hash).toBe("#other-section");

    expect(openSamePageClassRoster(getClassRosterHref("class-a"))).toBe(true);
    expect(window.location.search).toBe("?view=owned");
    clearClassRosterFragment();
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?view=owned");
    expect(window.history.state).toEqual({ preserved: "next-history" });
  });
});
