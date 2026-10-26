import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingSubmissionQueuePage } from "@/components/pages/teaching-submission-queue-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/providers/app-preferences", () => ({ useAppPreferences: () => ({ locale: "zh-CN" }) }));

const counts = { totalStudents: 32, notSubmitted: 9, submitted: 23, awaitingReview: 14, revisionRequested: 5, feedbackReleased: 11 };
function response(index: number) {
  return new Response(JSON.stringify({
    counts,
    submissions: [{ id: `submission-${index}`, state: "submitted", currentVersionNo: 1, currentVersionId: `version-${index}`, student: { account: `s-${index}`, displayName: `学生${index}` }, classId: "class-1", formative: { attempted: true, attemptCount: 1 } }],
    nextCursor: index === 1 ? "page-two" : null,
    dataFreshAt: "2026-10-26T08:00:00.000Z",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("TeachingSubmissionQueuePage class counts", () => {
  it("uses whole-activity server counts through pagination and filtering", async () => {
    let requests = 0;
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => response(++requests));
    vi.stubGlobal("fetch", fetchMock);
    render(<TeachingSubmissionQueuePage activityId="activity-raw-id" />);
    const summary = await screen.findByRole("region", { name: "全班作业概况" });
    expect(within(summary).getByLabelText("未交人数").textContent).toContain("9");
    expect(within(summary).getByLabelText("已交人数").textContent).toContain("23");
    expect(within(summary).getByLabelText("待修订人数").textContent).toContain("5");
    expect(within(summary).getByLabelText("已反馈人数").textContent).toContain("11");
    expect(within(summary).getByText(/32 位已批准加入目标班级的学生/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "加载下一页" }));
    await screen.findByText("学生2");
    expect(within(summary).getByLabelText("已交人数").textContent).toContain("23");
    fireEvent.click(screen.getByRole("button", { name: "已提交" }));
    await screen.findByText("学生3");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("state=submitted");
    expect(within(summary).getByLabelText("未交人数").textContent).toContain("9");
    expect(screen.queryByText(/P1 ·/)).toBeNull();
    expect(screen.queryByText("activity-raw-id")).toBeNull();
    expect(screen.getByText(/更新于/)).toBeTruthy();
    expect(within(summary).getByText(/人数可能重叠/)).toBeTruthy();
  });

  it("does not invent zero totals while the request is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    render(<TeachingSubmissionQueuePage activityId="activity-1" />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "全班作业概况" })).toBeNull();
  });
});
