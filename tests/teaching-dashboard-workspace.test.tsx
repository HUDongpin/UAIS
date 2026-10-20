import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnterpriseWorkspace } from "@/components/pages/teaching-page-enterprise-workspace";
import { teacherSidebarItems } from "@/data/uais";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

type WorkspaceProps = ComponentProps<typeof EnterpriseWorkspace>;
type DashboardId = "dashboard" | "quiz-board";

const courseId = "course /课程";
const counts = {
  notStarted: 2,
  draft: 3,
  submitted: 4,
  revisionRequested: 1,
  resubmitted: 1,
  accepted: 9,
  overdue: 17,
};

function insights(id = courseId, values = counts) {
  return {
    courseId: id,
    counts: values,
    projectionVersion: 21,
    dataFreshAt: "2026-10-20T01:00:00.000Z",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

function props(
  operationId: DashboardId = "dashboard",
  selectedCourseId: string | undefined = courseId,
  locale: WorkspaceProps["locale"] = "zh-CN",
): WorkspaceProps {
  const activeWorkspaceItem = teacherSidebarItems.find((item) => item.id === operationId);
  if (!activeWorkspaceItem) throw new Error(`Missing sidebar item: ${operationId}`);
  return {
    locale,
    activeWorkspaceItem,
    activeWorkspaceItemId: operationId,
    inlineWorkspaceStatuses: {},
    inlineWorkspaceAuditStatuses: {},
    inlineWorkspaceAlertStatuses: {},
    inlineWorkspaceAlertNotificationStatuses: {},
    inlineWorkspaceRollbackStatuses: {},
    inviteWorkspaceCode: "",
    inviteWorkspaceJoinUrl: "",
    inviteWorkspaceStatus: { "zh-CN": "", "en-US": "" },
    courseCards: [],
    learningChatroomGroupsEnabled: false,
    inviteCourseClasses: [],
    invitePolicyDraft: { expiresAtLocal: "", maxJoins: "", disabled: false },
    onSelectInviteClass: vi.fn(),
    onUpdateInvitePolicyDraft: vi.fn(),
    selectedCourseAction: selectedCourseId
      ? { courseId: selectedCourseId, action: "manage" }
      : undefined,
    selectedActionCourse: undefined,
    selectedCourseActionLabel: undefined,
    onSelectCourseAction: vi.fn(),
    copyInviteWorkspaceValue: vi.fn(),
    queueInlineWorkspaceAuditAlertNotifications: vi.fn(),
    runInlineWorkspaceAction: vi.fn(),
    runInlineWorkspaceRollback: vi.fn(),
    runInviteWorkspaceAction: vi.fn(),
    onReviewGroupSuggestions: vi.fn(),
  };
}

function metric(label: string | RegExp) {
  const labelElement = screen.getByText(label, { exact: true });
  const card = labelElement.closest("article") ?? labelElement.parentElement;
  if (!card) throw new Error(`Missing metric card: ${label}`);
  return within(card);
}

function expectNoFixedPercentages() {
  for (const value of ["88%", "71%", "91%"]) {
    expect(screen.queryByText(value, { exact: true })).toBeNull();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EnterpriseWorkspace real teaching dashboards", () => {
  it("reads the selected course and computes task rates without double-counting overdue records", async () => {
    const fetchMock = vi.fn(async () => json(insights()));
    vi.stubGlobal("fetch", fetchMock);
    render(<EnterpriseWorkspace {...props()} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/teaching/courses/${encodeURIComponent(courseId)}/learning-insights`,
      expect.objectContaining({ cache: "no-store" }),
    ));
    await waitFor(() => expect(metric("任务启动率").getByText("90%")).toBeTruthy());
    expect(metric("任务接受率").getByText("45%")).toBeTruthy();
    expect(metric("逾期任务").getByText("17")).toBeTruthy();
    expectNoFixedPercentages();
    expect(screen.queryByText("活跃率", { exact: true })).toBeNull();
    expect(screen.queryByText("进度中位数", { exact: true })).toBeNull();
    expect(screen.queryByText(/协作趋势较上周提升 6%/)).toBeNull();
  });

  it("uses historical submission states for the task submission rate and leaves unimplemented quiz metrics unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(insights())));
    render(<EnterpriseWorkspace {...props("quiz-board")} />);

    await waitFor(() => expect(metric("任务提交率").getByText("75%")).toBeTruthy());
    expect(metric("低质题").getByText(/暂不可用/)).toBeTruthy();
    expect(metric("错因簇").getByText(/暂不可用/)).toBeTruthy();
    expect(metric("低质题").queryByText("4", { exact: true })).toBeNull();
    expect(metric("错因簇").queryByText("7", { exact: true })).toBeNull();
    expectNoFixedPercentages();
    expect(screen.queryByText(/4 道题进入低质题复核/)).toBeNull();
    expect(screen.queryByRole("button", { name: /标记低质题复核/ })).toBeNull();
  });

  it("does not query or present sample numbers before a course is selected", () => {
    const fetchMock = vi.fn(async () => json(insights()));
    vi.stubGlobal("fetch", fetchMock);
    const input = props();
    input.selectedCourseAction = undefined;
    render(<EnterpriseWorkspace {...input} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByText(/请选择课程|先选择课程/).length).toBeGreaterThan(0);
    expectNoFixedPercentages();
    expect(screen.queryByText("90%", { exact: true })).toBeNull();
  });

  it("shows no sample values while a real request is pending", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<EnterpriseWorkspace {...props()} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectNoFixedPercentages();
    expect(screen.queryByText("90%", { exact: true })).toBeNull();
    expect(screen.getByText(/正在读取/)).toBeTruthy();
  });

  it.each([
    ["dashboard", "任务启动率", "任务接受率"],
    ["quiz-board", "任务提交率", undefined],
  ] as const)("uses an empty percentage rather than inventing a rate for an empty %s", async (operationId, firstLabel, secondLabel) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(insights(courseId, {
      notStarted: 0, draft: 0, submitted: 0, revisionRequested: 0,
      resubmitted: 0, accepted: 0, overdue: 0,
    }))));
    render(<EnterpriseWorkspace {...props(operationId)} />);

    await waitFor(() => expect(metric(firstLabel).getByText("—")).toBeTruthy());
    if (secondLabel) expect(metric(secondLabel).getByText("—")).toBeTruthy();
    expectNoFixedPercentages();
    expect(screen.queryByText("NaN%", { exact: true })).toBeNull();
    expect(screen.queryByText("0%", { exact: true })).toBeNull();
  });

  it.each([
    ["dashboard", "刷新数据看板", "任务接受率", "50%"],
    ["quiz-board", "刷新测验看板", "任务提交率", "100%"],
  ] as const)("refreshes %s with a read and never invokes the old operation write", async (operationId, buttonLabel, metricLabel, nextValue) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(insights()))
      .mockResolvedValueOnce(json(insights(courseId, {
        notStarted: 0, draft: 0, submitted: 1, revisionRequested: 0,
        resubmitted: 0, accepted: 1, overdue: 0,
      })));
    vi.stubGlobal("fetch", fetchMock);
    const input = props(operationId);
    render(<EnterpriseWorkspace {...input} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: buttonLabel })).toHaveProperty("disabled", false));

    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
    await waitFor(() => expect(metric(metricLabel).getByText(nextValue)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(`/api/teaching/courses/${encodeURIComponent(courseId)}/learning-insights`);
      expect(init).toMatchObject({ cache: "no-store" });
      expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
    expect(input.runInlineWorkspaceAction).not.toHaveBeenCalled();
  });

  it.each([
    ["permission denied", () => json({ reasonCode: "teacher-course-ownership-required" }, 403)],
    ["service unavailable", () => json({ reasonCode: "learning-insights-read-failed" }, 503)],
    ["network failure", () => { throw new TypeError("network unavailable"); }],
    ["invalid metric counts", () => json({ ...insights(), counts: { ...counts, accepted: -1 } })],
    ["mismatched course", () => json(insights("another-course"))],
  ] as const)("clears previously displayed values when a refresh returns %s", async (_name, response) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(insights()))
      .mockImplementationOnce(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const input = props();
    render(<EnterpriseWorkspace {...input} />);
    await waitFor(() => expect(metric("任务接受率").getByText("45%")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "刷新数据看板" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("45%", { exact: true })).toBeNull();
    expect(screen.queryByText("90%", { exact: true })).toBeNull();
    expectNoFixedPercentages();
    expect(input.runInlineWorkspaceAction).not.toHaveBeenCalled();
  });

  it("clears old metrics on a course switch and ignores a late response from the former course", async () => {
    const former = deferredResponse();
    const current = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(insights()))
      .mockImplementationOnce(() => former.promise)
      .mockImplementationOnce(() => current.promise);
    vi.stubGlobal("fetch", fetchMock);
    const input = props();
    const view = render(<EnterpriseWorkspace {...input} />);
    await waitFor(() => expect(metric("任务接受率").getByText("45%")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "刷新数据看板" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    view.rerender(<EnterpriseWorkspace {...props("dashboard", "new-course")} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("45%", { exact: true })).toBeNull();
    await act(async () => {
      current.resolve(json(insights("new-course", {
        notStarted: 1, draft: 0, submitted: 0, revisionRequested: 0,
        resubmitted: 0, accepted: 3, overdue: 0,
      })));
    });
    expect(metric("任务接受率").getByText("75%")).toBeTruthy();
    await act(async () => { former.resolve(json(insights())); });
    expect(metric("任务接受率").getByText("75%")).toBeTruthy();
    expect(screen.queryByText("45%", { exact: true })).toBeNull();
  });

  it("clears previously loaded values when the course selection is removed", async () => {
    const fetchMock = vi.fn(async () => json(insights()));
    vi.stubGlobal("fetch", fetchMock);
    const input = props();
    const view = render(<EnterpriseWorkspace {...input} />);
    await waitFor(() => expect(metric("任务接受率").getByText("45%")).toBeTruthy());

    view.rerender(<EnterpriseWorkspace {...input} selectedCourseAction={undefined} />);
    expect(screen.queryByText("45%", { exact: true })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/请选择课程|先选择课程/).length).toBeGreaterThan(0);
  });

  it("renders the same real quiz data and availability states in English", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(insights())));
    render(<EnterpriseWorkspace {...props("quiz-board", courseId, "en-US")} />);

    await waitFor(() => expect(metric(/^Task Submission Rate$/i).getByText("75%")).toBeTruthy());
    expect(metric(/^Low-Quality Items$/i).getByText(/unavailable/i)).toBeTruthy();
    expect(metric(/^Error Clusters$/i).getByText(/unavailable/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Refresh Quiz Board/i })).toBeTruthy();
    expectNoFixedPercentages();
  });
});
