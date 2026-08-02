import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CoursesRoutePage from "@/app/courses/page";
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
  vi.unstubAllGlobals();
});

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

    expect(screen.getByRole("alert").textContent).toContain(
      "邀请码链接无效，请检查链接或向教师确认。",
    );
    expect(document.body.textContent).not.toContain("../secret-token");
    expect(screen.queryByRole("button", { name: "申请加入班级" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
    const pageWithoutSearchParams = await CoursesRoutePage();

    expect(pageWithoutInvite.props.inviteParam).toBeUndefined();
    expect(pageWithoutSearchParams.props.inviteParam).toBeUndefined();
  });
});
