import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentDashboardPage } from "@/components/pages/student-dashboard-page";

// Phase 4 student surface: the dashboard "Group Signal" card renders the real
// group projection from GET /api/teaching/courses (group name, co-member display
// names, self marker) and deep-links into the shared chatroom room with
// `?groupId=`. Without a group the existing static placeholder card is kept.

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
    theme: "light",
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

afterEach(() => {
  mockPreferences.locale = "zh-CN";
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const courseId = "teacher-course-group-workspace-20260808";
const classId = `${courseId}-class-1`;

function createStudentCourseListBody(
  learningGroups: Array<{
    groupId: string;
    courseId: string;
    classId?: string;
    groupName: string;
    members: Array<{ displayName: string; isSelf: boolean }>;
  }>,
) {
  return {
    courses: [
      {
        courseId,
        courseName: "小组协作研究方法",
        semester: "2026 春季",
      },
    ],
    classes: [
      {
        classId,
        courseId,
        className: "研究方法实验班",
        semester: "2026 春季",
      },
    ],
    memberships: [
      {
        membershipId: "membership-student-peter",
        courseId,
        classId,
        membershipStatus: "approved",
        joinedAt: "2026-08-01T08:00:00.000Z",
        approvedAt: "2026-08-01T09:00:00.000Z",
      },
    ],
    learningGroups,
  };
}

// A flag-off deployment (plan D9) omits the student group projection entirely
// and reports the decision in `features`; the rest of the student payload is
// unchanged.
function createDarkStudentCourseListBody() {
  const body = createStudentCourseListBody([]);
  delete (body as { learningGroups?: unknown }).learningGroups;
  return { ...body, features: { learningChatroomGroups: false } };
}

function stubStudentCourseListFetch(
  body:
    | ReturnType<typeof createStudentCourseListBody>
    | ReturnType<typeof createDarkStudentCourseListBody>,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("/api/teaching/courses");
    expect(init?.method).toBe("GET");
    return Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("student dashboard group signal card", () => {
  it("renders the student's real group with co-members and a chatroom deep link", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    stubStudentCourseListFetch(
      createStudentCourseListBody([
        {
          groupId: "group-alpha-20260808",
          courseId,
          classId,
          groupName: "证据链小组",
          members: [
            { displayName: "Peter", isSelf: true },
            { displayName: "林若晨", isSelf: false },
            { displayName: "赵一诺", isSelf: false },
          ],
        },
      ]),
    );

    const { container } = render(<StudentDashboardPage />);

    await waitFor(() => {
      expect(container.querySelector("[data-uais-student-group-signal]")).toBeTruthy();
    });
    const card = within(
      container.querySelector("[data-uais-student-group-signal]") as HTMLElement,
    );
    expect(card.getByRole("heading", { name: "我的小组" })).toBeTruthy();
    expect(card.getByText("证据链小组")).toBeTruthy();
    expect(card.getByText("Peter（我）")).toBeTruthy();
    expect(card.getByText("林若晨")).toBeTruthy();
    expect(card.getByText("赵一诺")).toBeTruthy();
    expect(card.getByRole("link", { name: "进入聊天室" }).getAttribute("href")).toBe(
      `/learning/chatroom?courseId=${courseId}&groupId=group-alpha-20260808`,
    );
    // The static chatroom placeholder is replaced once a real group exists.
    expect(screen.queryByText("人机协作聊天室")).toBeNull();
  });

  it("lists every group the student belongs to", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    stubStudentCourseListFetch(
      createStudentCourseListBody([
        {
          groupId: "group-alpha-20260808",
          courseId,
          groupName: "证据链小组",
          members: [
            { displayName: "Peter", isSelf: true },
            { displayName: "林若晨", isSelf: false },
          ],
        },
        {
          groupId: "group-beta-20260808",
          courseId,
          groupName: "写作互评小组",
          members: [
            { displayName: "Peter", isSelf: true },
            { displayName: "陈嘉树", isSelf: false },
          ],
        },
      ]),
    );

    const { container } = render(<StudentDashboardPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-uais-student-group="group-beta-20260808"]')).toBeTruthy();
    });
    expect(
      container.querySelector('[data-uais-student-group="group-alpha-20260808"]'),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "进入聊天室" })
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      `/learning/chatroom?courseId=${courseId}&groupId=group-alpha-20260808`,
      `/learning/chatroom?courseId=${courseId}&groupId=group-beta-20260808`,
    ]);
  });

  it("keeps the placeholder collaboration card when the student has no group", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    const fetchMock = stubStudentCourseListFetch(createStudentCourseListBody([]));

    const { container } = render(<StudentDashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId("student-membership-membership-student-peter")).toBeTruthy();
    });
    expect(container.querySelector("[data-uais-student-group-signal]")).toBeNull();
    expect(screen.getByRole("heading", { name: "人机协作聊天室" })).toBeTruthy();
  });

  it("falls back to the placeholder card while groups ship dark", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    const fetchMock = stubStudentCourseListFetch(createDarkStudentCourseListBody());

    const { container } = render(<StudentDashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    // The membership list still loads, proving the payload was read and only
    // the group projection was withheld.
    await waitFor(() => {
      expect(screen.getByTestId("student-membership-membership-student-peter")).toBeTruthy();
    });
    expect(container.querySelector("[data-uais-student-group-signal]")).toBeNull();
    expect(screen.getByRole("heading", { name: "人机协作聊天室" })).toBeTruthy();
    // The placeholder still links to the per-student chatroom, but no `groupId`
    // deep link is offered anywhere: the dashboard never sends a student to a
    // room the chatroom API would refuse.
    expect(
      screen.queryAllByRole("link", { name: "进入聊天室" }).map((link) => link.getAttribute("href")),
    ).toEqual(["/learning/chatroom"]);
    expect(container.innerHTML).not.toContain("groupId=");
  });

  it("renders the group card in English under the en-US locale", async () => {
    mockPreferences.locale = "en-US";
    window.history.replaceState(null, "", "/student-dashboard");
    stubStudentCourseListFetch(
      createStudentCourseListBody([
        {
          groupId: "group-alpha-20260808",
          courseId,
          groupName: "Evidence Chain Group",
          members: [
            { displayName: "Peter", isSelf: true },
            { displayName: "Lin Ruochen", isSelf: false },
          ],
        },
      ]),
    );

    const { container } = render(<StudentDashboardPage />);

    await waitFor(() => {
      expect(container.querySelector("[data-uais-student-group-signal]")).toBeTruthy();
    });
    const card = within(
      container.querySelector("[data-uais-student-group-signal]") as HTMLElement,
    );
    expect(card.getByRole("heading", { name: "My Group" })).toBeTruthy();
    expect(card.getByText("Peter (you)")).toBeTruthy();
    expect(card.getByRole("link", { name: "Open Chatroom" }).getAttribute("href")).toBe(
      `/learning/chatroom?courseId=${courseId}&groupId=group-alpha-20260808`,
    );
  });
});
