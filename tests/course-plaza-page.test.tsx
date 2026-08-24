import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CoursesRoutePage from "@/app/courses/page";
import {
  CoursePlazaPage,
  createLoginHandoffHref,
  isSafeLoginReturnPath,
} from "@/components/pages/course-plaza-page";

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
  // The membership read only fires on the real /courses path, so tests that opt
  // into it must not leave the URL behind for the ones that do not.
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

// The student projection of `/api/teaching/courses`: one approved class and one
// still waiting for the teacher.
const plazaMembershipCoursesResponse = {
  courses: [
    {
      courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
      courseName: "AI 支持的初等数学研究",
      semester: "2026 春",
    },
    {
      courseId: "teacher-course-statistics-writing-20260622-112000",
      courseName: "统计写作工作坊",
      semester: "2026 春",
    },
  ],
  classes: [
    {
      classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
      courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
      className: "研究方法一班",
      semester: "2026 春",
    },
    {
      classId: "teacher-course-statistics-writing-20260622-112000-class-1",
      courseId: "teacher-course-statistics-writing-20260622-112000",
      className: "统计写作一班",
      semester: "2026 春",
    },
  ],
  memberships: [
    {
      membershipId: "membership-approved",
      courseId: "teacher-course-ai-supported-mathematics-research-20260622-112000",
      classId: "teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
      membershipStatus: "approved",
    },
    {
      membershipId: "membership-pending",
      courseId: "teacher-course-statistics-writing-20260622-112000",
      classId: "teacher-course-statistics-writing-20260622-112000-class-1",
      membershipStatus: "pending-teacher-review",
    },
  ],
};

// Holds a join POST open so the tests can drive the window between "request
// sent" and "response handled", which is where invite-param switches land.
function createDeferredJoinResponse() {
  let resolveJoinResponse: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveJoinResponse = resolve;
  });

  return { promise, resolve: resolveJoinResponse };
}

function readJoinButton(name = "申请加入班级") {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

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

    // The manual invite-code panel is a level-2 section of the plaza too, and it
    // sits above the course cards.
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "输入邀请码加入班级",
      // The samples are named as samples for every visitor now, signed out
      // included (E16/R1), so their heading sits between the invite box and the
      // cards it labels.
      "示例课程",
      "数学教学法",
      "大学研究方法",
    ]);
    expect(screen.getAllByText(/^授课教师：/).map((teacher) => teacher.textContent)).toEqual([
      "授课教师：康霞老师",
      "授课教师：吴亚军老师",
    ]);
  });

  it("filters courses and offers a clear action from the no-results state", () => {
    render(<CoursePlazaPage />);

    const search = screen.getByRole("searchbox", { name: "搜索课程" });
    fireEvent.change(search, { target: { value: "不存在的课程" } });

    expect(screen.getByRole("status").textContent).toContain("没有找到匹配的课程");
    expect(screen.queryByRole("heading", { name: "数学教学法" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "大学研究方法" })).toBeNull();
    expect(screen.getByLabelText("邀请码")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("heading", { name: "数学教学法" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "大学研究方法" })).toBeTruthy();
  });

  // E16/R1: the "第 1 / 12 单元, 8%" bar was template art - nobody had ever
  // completed a unit of these. It used to be hidden only once the visitor's own
  // classes appeared above it, which left the invented figure showing to exactly
  // the visitors who could not tell it was invented: signed-out ones.
  it("shows no invented unit progress on the sample cards for a signed-out visitor", () => {
    const { container } = render(<CoursePlazaPage />);

    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
    expect(container.textContent).not.toContain("第 1 / 12 单元");
    expect(container.textContent).not.toContain("8%");

    cleanup();
    mockPreferences.locale = "en-US";
    const english = render(<CoursePlazaPage />);
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
    expect(english.container.textContent).not.toContain("Unit 1 of 12");
  });

  it("names the sample cards as samples for a signed-out visitor too", () => {
    const { container } = render(<CoursePlazaPage />);

    expect(
      container.querySelector('[data-uais-plaza-sample-heading="true"]')?.textContent,
    ).toContain("示例课程");
    // Still labelled `primary` while nothing else is on the page: naming them is
    // not the same as demoting them, and the join affordances are untouched.
    expect(
      container
        .querySelector("[data-uais-plaza-sample-courses]")
        ?.getAttribute("data-uais-plaza-sample-courses"),
    ).toBe("primary");

    cleanup();
    mockPreferences.locale = "en-US";
    const english = render(<CoursePlazaPage />);
    expect(
      english.container.querySelector('[data-uais-plaza-sample-heading="true"]')
        ?.textContent,
    ).toContain("Sample courses");
  });

  // E14/PKG-8b: the plaza rendered nothing but the two template sample cards, so
  // a student who had already joined a real class through an invite code came
  // back here and found no trace of it - only two demo courses with invented
  // unit-progress bars, each offering "进入学习" into a course they are not in.
  it("puts the signed-in visitor's real classes above the demoted sample cards", async () => {
    window.history.replaceState(null, "", "/courses");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/teaching/courses");
      expect(init?.method).toBe("GET");
      return Response.json(plazaMembershipCoursesResponse);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CoursePlazaPage />);

    const myCourses = await waitFor(() => {
      const section = container.querySelector<HTMLElement>('[data-uais-plaza-my-courses="true"]');
      expect(section).toBeTruthy();
      return section as HTMLElement;
    });
    expect(myCourses.textContent).toContain("我的课程");
    expect(myCourses.textContent).toContain("AI 支持的初等数学研究");
    expect(myCourses.textContent).toContain("研究方法一班");
    expect(myCourses.textContent).toContain("已加入");
    expect(myCourses.textContent).toContain("统计写作工作坊");
    expect(myCourses.textContent).toContain("等待教师审批");

    const approvedCard = container.querySelector<HTMLElement>(
      '[data-uais-plaza-membership="membership-approved"]',
    );
    expect(
      approvedCard?.querySelector("a")?.getAttribute("href"),
    ).toBe(
      "/learning?courseId=teacher-course-ai-supported-mathematics-research-20260622-112000&classId=teacher-course-ai-supported-mathematics-research-20260622-112000-class-1",
    );
    // A pending class has no workspace to enter, so it offers no link at all
    // rather than one that would be refused.
    expect(
      container
        .querySelector('[data-uais-plaza-membership="membership-pending"]')
        ?.querySelector("a"),
    ).toBeNull();

    const sampleSection = container.querySelector<HTMLElement>(
      '[data-uais-plaza-sample-courses]',
    );
    expect(sampleSection?.getAttribute("data-uais-plaza-sample-courses")).toBe("demoted");
    expect(screen.getByText("示例课程")).toBeTruthy();
    // The samples stay as cards, but their invented "第 1 / 12 单元, 8%" bars do
    // not survive next to a real class list.
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
    expect(container.textContent).not.toContain("第 1 / 12 单元");

    // Real classes first, samples after.
    const myCoursesPosition = myCourses.compareDocumentPosition(sampleSection as HTMLElement);
    expect(myCoursesPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains a declined or removed class instead of dropping it off the plaza", async () => {
    window.history.replaceState(null, "", "/courses");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...plazaMembershipCoursesResponse,
          memberships: [
            { ...plazaMembershipCoursesResponse.memberships[0], membershipStatus: "removed" },
            { ...plazaMembershipCoursesResponse.memberships[1], membershipStatus: "rejected" },
          ],
        }),
      ),
    );

    const { container } = render(<CoursePlazaPage />);

    const myCourses = await waitFor(() => {
      const section = container.querySelector<HTMLElement>('[data-uais-plaza-my-courses="true"]');
      expect(section).toBeTruthy();
      return section as HTMLElement;
    });
    // Both statuses used to be filtered out of the route's student branch, so
    // the class simply left the plaza with nothing to read anywhere.
    expect(myCourses.textContent).toContain("已被移出班级");
    expect(myCourses.textContent).toContain("教师未通过申请");
    expect(myCourses.textContent).toContain("这个班级已不在你的学习列表中");
    expect(
      [...myCourses.querySelectorAll("[data-uais-plaza-membership-status]")].map((badge) =>
        badge.getAttribute("data-uais-plaza-membership-status"),
      ),
    ).toEqual(["removed", "rejected"]);

    for (const membershipId of ["membership-approved", "membership-pending"]) {
      expect(
        container
          .querySelector(`[data-uais-plaza-membership="${membershipId}"]`)
          ?.querySelector("a"),
      ).toBeNull();
    }
  });

  it("keeps the sample plaza intact for a visitor the courses read refuses", async () => {
    window.history.replaceState(null, "", "/courses");
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "student session required" }, { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CoursePlazaPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(container.querySelector('[data-uais-plaza-my-courses="true"]')).toBeNull();
    expect(
      container
        .querySelector("[data-uais-plaza-sample-courses]")
        ?.getAttribute("data-uais-plaza-sample-courses"),
    ).toBe("primary");
    // Signed out is the plaza's resting state: the sample cards and the invite
    // box both stay, and nothing claims the visitor has no courses.
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "输入邀请码加入班级",
      // The samples are named as samples for every visitor now, signed out
      // included (E16/R1), so their heading sits between the invite box and the
      // cards it labels.
      "示例课程",
      "数学教学法",
      "大学研究方法",
    ]);
    expect(screen.getByLabelText("邀请码")).toBeTruthy();
  });

  it("links each course Enter Learning action to its matching learning workspace", () => {
    render(<CoursePlazaPage />);

    const enterLearningLinks = screen.getAllByRole("link", { name: "进入学习" });

    expect(enterLearningLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/learning?courseId=math-pedagogy-learning",
      "/learning?courseId=research-methods-learning",
    ]);
  });

  it("seeds the invite join panel from the server-provided invite param on the first render", () => {
    // The browser URL deliberately carries no invite param: the initial state
    // must come from the server-rendered prop only, so the first client render
    // matches the server render instead of hydrating into a mismatch.
    window.history.replaceState(null, "", "/");

    const serverMarkup = renderToStaticMarkup(<CoursePlazaPage inviteParam="66334455" />);
    render(<CoursePlazaPage inviteParam="66334455" />);

    expect(serverMarkup).toContain("邀请码：66334455");
    expect(screen.getByText("邀请码：66334455")).toBeTruthy();
    expect(screen.getByRole("button", { name: "申请加入班级" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("seeds the invalid invite state deterministically for an unusable invite param", () => {
    window.history.replaceState(null, "", "/");

    const serverMarkup = renderToStaticMarkup(<CoursePlazaPage inviteParam="../secret-token" />);
    render(<CoursePlazaPage inviteParam="../secret-token" />);

    expect(serverMarkup).toContain("邀请码链接无效，请检查链接或向教师确认。");
    expect(serverMarkup).not.toContain("../secret-token");
    expect(screen.getByRole("alert").textContent).toContain(
      "邀请码链接无效，请检查链接或向教师确认。",
    );
    expect(screen.queryByRole("button", { name: "申请加入班级" })).toBeNull();
  });

  it("stays in the absent invite state when the route provides no invite param", () => {
    window.history.replaceState(null, "", "/courses?invite=66334455");

    render(<CoursePlazaPage />);

    expect(screen.queryByText("邀请码：66334455")).toBeNull();
    expect(screen.queryByRole("button", { name: "申请加入班级" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    window.history.replaceState(null, "", "/");
  });

  it("follows the current invite param across client-side navigation instead of freezing the first one", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { membership: { membershipStatus: "pending-teacher-review" } },
        { status: 201, headers: { "x-uais-trace-id": "trace-stale-invite" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // App Router client navigation swaps this prop without remounting the
    // component, so the panel must never outlive the param that produced it.
    const { rerender } = render(<CoursePlazaPage inviteParam="55395057" />);

    expect(screen.getByText("邀请码：55395057")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "申请加入班级" }));
    await waitFor(() => {
      expect(
        screen.getByText("加入申请已提交，等待教师审批。追踪编号：trace-stale-invite"),
      ).toBeTruthy();
    });

    // Header link back to /courses with no invite param.
    rerender(<CoursePlazaPage />);

    expect(screen.queryByText("邀请码：55395057")).toBeNull();
    expect(screen.queryByRole("button", { name: "申请加入班级" })).toBeNull();
    expect(document.body.textContent).not.toContain("加入申请已提交");

    // A different invite link shows the new code with a reset join status.
    rerender(<CoursePlazaPage inviteParam="66334455" />);

    expect(screen.getByText("邀请码：66334455")).toBeTruthy();
    expect(screen.queryByText("邀请码：55395057")).toBeNull();
    expect(document.body.textContent).not.toContain("加入申请已提交");
    expect(screen.getByRole("button", { name: "申请加入班级" })).toBeTruthy();

    // An unusable invite link resolves to the invalid state on the same instance.
    rerender(<CoursePlazaPage inviteParam="../secret-token" />);

    expect(screen.getByRole("alert").textContent).toContain(
      "邀请码链接无效，请检查链接或向教师确认。",
    );
    expect(screen.queryByText("邀请码：66334455")).toBeNull();
    expect(screen.queryByRole("button", { name: "申请加入班级" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the join button disabled after navigating to another invite while the first join is in flight", async () => {
    const deferredJoinResponse = createDeferredJoinResponse();
    const fetchMock = vi.fn(async () => deferredJoinResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<CoursePlazaPage inviteParam="55395057" />);

    fireEvent.click(readJoinButton());
    await screen.findByRole("button", { name: "正在提交" });

    // While this invite is running its own join, its own pending message is the
    // only one on screen: the cross-invite explanation must not double up.
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual([
      "正在提交加入申请，请稍候。",
    ]);

    // Client navigation to a second invite link while the first join POST is
    // still open. The displayed status resets with the param, but the request
    // behind it has not finished, so the button must stay unavailable.
    rerender(<CoursePlazaPage inviteParam="66334455" />);

    expect(screen.getByText("邀请码：66334455")).toBeTruthy();
    const secondInviteJoinButton = readJoinButton();
    expect(secondInviteJoinButton.disabled).toBe(true);

    // A disabled control needs a stated reason: the second panel has no status
    // of its own, so it must explain that another join is holding the button.
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual([
      "另一个加入申请仍在提交中，请稍候。",
    ]);
    const describedById = secondInviteJoinButton.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedById)?.textContent).toBe(
      "另一个加入申请仍在提交中，请稍候。",
    );

    fireEvent.click(secondInviteJoinButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/invite-codes/55395057/join",
      expect.objectContaining({ method: "POST" }),
    );

    // Once the open request settles the second invite becomes submittable again.
    deferredJoinResponse.resolve(
      Response.json(
        { membership: { membershipStatus: "pending-teacher-review" } },
        { status: 201, headers: { "x-uais-trace-id": "trace-in-flight-invite" } },
      ),
    );
    await waitFor(() => {
      expect(readJoinButton().disabled).toBe(false);
    });

    // The explanation is tied to the block, not left behind once it clears.
    expect(screen.queryByText("另一个加入申请仍在提交中，请稍候。")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(readJoinButton().getAttribute("aria-describedby")).toBeNull();
  });

  it("starts a single join request when the button is pressed twice before the pending render lands", async () => {
    const deferredJoinResponse = createDeferredJoinResponse();
    const fetchMock = vi.fn(async () => deferredJoinResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(<CoursePlazaPage inviteParam="55395057" />);
    const joinButton = readJoinButton();

    // Both clicks are delivered inside one act() batch, so the second handler
    // still sees the pre-pending render and only the in-flight tracking that is
    // updated synchronously can stop the duplicate POST.
    act(() => {
      fireEvent.click(joinButton);
      fireEvent.click(joinButton);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    deferredJoinResponse.resolve(
      Response.json(
        { membership: { membershipStatus: "pending-teacher-review" } },
        { status: 201, headers: { "x-uais-trace-id": "trace-double-click-invite" } },
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByText("加入申请已提交，等待教师审批。追踪编号：trace-double-click-invite"),
      ).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("discards a superseded invite response instead of repainting the panel it no longer belongs to", async () => {
    const deferredJoinResponse = createDeferredJoinResponse();
    const fetchMock = vi.fn(async () => deferredJoinResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<CoursePlazaPage inviteParam="55395057" />);

    fireEvent.click(readJoinButton());
    await screen.findByRole("button", { name: "正在提交" });

    rerender(<CoursePlazaPage inviteParam="66334455" />);

    // The first invite answers late, after the student has moved to another one.
    deferredJoinResponse.resolve(
      Response.json(
        {
          error: "student-course-membership-already-exists",
          traceId: "trace-superseded-invite",
        },
        { status: 409 },
      ),
    );

    // The button becoming submittable again proves the superseded response was
    // fully processed, so the assertions below are not racing it.
    await waitFor(() => {
      expect(readJoinButton().disabled).toBe(false);
    });

    expect(screen.getByText("邀请码：66334455")).toBeTruthy();
    expect(document.body.textContent).not.toContain("加入申请未提交");
    expect(document.body.textContent).not.toContain("加入申请已提交");
    expect(document.body.textContent).not.toContain("正在提交加入申请");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Returning to the superseded invite must not resurrect its discarded
    // outcome, nor leave the panel frozen on the pending status it started.
    rerender(<CoursePlazaPage inviteParam="55395057" />);

    expect(screen.getByText("邀请码：55395057")).toBeTruthy();
    expect(document.body.textContent).not.toContain("加入申请未提交");
    expect(document.body.textContent).not.toContain("正在提交加入申请");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(readJoinButton().disabled).toBe(false);
  });

  it("lets a signed-in student submit an invite-code join request from the plaza", async () => {
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

    render(<CoursePlazaPage inviteParam="66334455" />);

    expect(screen.getByText("邀请码：66334455")).toBeTruthy();
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
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CoursePlazaPage inviteParam="../secret-token" />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("邀请码链接无效，请检查链接或向教师确认。");
    // Light-only rose classes rendered as near-black text on a pale pink slab in
    // dark mode - the failure alert was the least readable thing on the page for
    // exactly the reader who needed it. Paired with the dark tokens its
    // neighbours already use (see learning-page-chatroom.tsx).
    for (const darkClass of ["dark:border-rose-900", "dark:bg-rose-950", "dark:text-rose-200"]) {
      expect(alert.className).toContain(darkClass);
    }
    expect(document.body.textContent).not.toContain("../secret-token");
    expect(screen.queryByRole("button", { name: "申请加入班级" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Plan E9 (PKG-5): student entry. A code handed out on a slide arrives without
  // a link, and a signed-out student needs a way back to the invite after login.
  // ---------------------------------------------------------------------------

  it("submits a manually typed invite code through the same join route as the link", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ membership: { membershipStatus: "pending-teacher-review" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CoursePlazaPage />);

    fireEvent.change(screen.getByLabelText("邀请码"), { target: { value: "66334455" } });
    fireEvent.click(screen.getByRole("button", { name: "使用邀请码加入" }));

    await waitFor(() => {
      expect(screen.getByText("加入申请已提交，等待教师审批。")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/invite-codes/66334455/join",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refuses a malformed typed invite code without calling the join route", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CoursePlazaPage />);

    fireEvent.change(screen.getByLabelText("邀请码"), {
      target: { value: "../secret-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "使用邀请码加入" }));

    expect(screen.getByText("邀请码格式无效，请检查后重试。")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers a sign-in handoff back to the invite when the join route needs a student session", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          error: "UAIS student session is required.",
          traceId: "trace-join-session",
          access: { reasonCode: "student-session-required" },
        },
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CoursePlazaPage inviteParam="66334455" />);

    fireEvent.click(readJoinButton());

    await waitFor(() => {
      expect(screen.getByText(/需要登录学生账号。/)).toBeTruthy();
    });
    const handoff = document.querySelector(
      '[data-uais-invite-login-handoff="66334455"]',
    ) as HTMLAnchorElement;
    expect(handoff).toBeTruthy();
    // Same-origin relative return path only: leading slash, no scheme, no `//`.
    expect(handoff.getAttribute("href")).toBe(
      `/login?from=${encodeURIComponent("/courses?invite=66334455")}`,
    );
  });

  it("renders a store-level reason code as Chinese copy instead of the route's English string", async () => {
    // The invite-code policy refusals put their code at the TOP level of the
    // body, not under `access` - the mapping has to read both shapes.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "Teaching class invite code is disabled.",
            reasonCode: "invite-code-disabled",
            traceId: "trace-invite-disabled",
          },
          { status: 403 },
        ),
      ),
    );

    render(<CoursePlazaPage inviteParam="66334455" />);

    fireEvent.click(readJoinButton());

    await waitFor(() => {
      expect(
        screen.getByText(
          "加入申请未提交：该邀请码已被教师停用，请向教师索取新的邀请码。追踪编号：trace-invite-disabled",
        ),
      ).toBeTruthy();
    });
    // The operator-facing English never becomes the student's instruction, and
    // there is nothing to collapse because the code was understood.
    expect(document.body.textContent).not.toContain("invite code is disabled");
    expect(document.querySelector("[data-uais-invite-join-failure-detail]")).toBeNull();
  });

  it("keeps an unmapped server string collapsed behind a generic bilingual sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "Teaching invite-code join request failed.",
            reasonCode: "an-unmapped-future-reason-code",
          },
          { status: 500 },
        ),
      ),
    );

    render(<CoursePlazaPage inviteParam="66334455" />);

    fireEvent.click(readJoinButton());

    await waitFor(() => {
      expect(screen.getByText("加入申请未提交，请稍后重试。")).toBeTruthy();
    });
    const detail = document.querySelector("[data-uais-invite-join-failure-detail]");
    expect(detail?.tagName).toBe("DETAILS");
    expect(detail?.textContent).toContain("Teaching invite-code join request failed.");
    expect(detail?.querySelector("summary")?.textContent).toBe("技术详情");
  });

  it("offers the sign-in handoff for a typed code too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { access: { reasonCode: "student-session-required" } },
          { status: 401 },
        ),
      ),
    );

    render(<CoursePlazaPage />);

    fireEvent.change(screen.getByLabelText("邀请码"), { target: { value: "66334455" } });
    fireEvent.click(screen.getByRole("button", { name: "使用邀请码加入" }));

    await waitFor(() => {
      expect(document.querySelector("[data-uais-manual-invite-login-handoff]")).toBeTruthy();
    });
    expect(
      document
        .querySelector("[data-uais-manual-invite-login-handoff]")
        ?.getAttribute("href"),
    ).toBe(`/login?from=${encodeURIComponent("/courses?invite=66334455")}`);
  });

  it("refuses to hand off to anything that is not a same-origin relative path", () => {
    // Guards the login handoff itself: a scheme, a protocol-relative host or a
    // bare path must never become a `from=` the login page would follow.
    expect(isSafeLoginReturnPath("/courses?invite=66334455")).toBe(true);
    expect(isSafeLoginReturnPath("//evil.example/courses")).toBe(false);
    expect(isSafeLoginReturnPath("https://evil.example/courses")).toBe(false);
    expect(isSafeLoginReturnPath("javascript:alert(1)")).toBe(false);
    expect(isSafeLoginReturnPath("courses?invite=1")).toBe(false);
    expect(createLoginHandoffHref("https://evil.example")).toBe("/login");
    expect(createLoginHandoffHref("//evil.example")).toBe("/login");
  });
});

describe("courses route", () => {
  it("awaits the invite search param and threads it into the course plaza", async () => {
    const page = await CoursesRoutePage({
      searchParams: Promise.resolve({ invite: "55395057" }),
    });

    expect(page.props.inviteParam).toBe("55395057");
  });

  it("threads the first value when the invite search param repeats", async () => {
    const page = await CoursesRoutePage({
      searchParams: Promise.resolve({ invite: ["55395057", "66334455"] }),
    });

    expect(page.props.inviteParam).toBe("55395057");
  });

  it("leaves the invite param absent when the route carries no invite query", async () => {
    const pageWithoutInvite = await CoursesRoutePage({
      searchParams: Promise.resolve({}),
    });
    const pageWithoutSearchParams = await CoursesRoutePage({});

    expect(pageWithoutInvite.props.inviteParam).toBeUndefined();
    expect(pageWithoutSearchParams.props.inviteParam).toBeUndefined();
  });
});
