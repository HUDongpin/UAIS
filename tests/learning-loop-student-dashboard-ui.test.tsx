import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentDashboardPage } from "@/components/pages/student-dashboard-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({ locale: "zh-CN" }),
}));

const membershipBody = {
  courses: [{ courseId: "course-1", courseName: "真实课程", semester: "2026 秋季" }],
  classes: [{ courseId: "course-1", classId: "class-1", className: "真实一班", semester: "2026 秋季" }],
  memberships: [{ membershipId: "membership-1", courseId: "course-1", classId: "class-1", membershipStatus: "approved" }],
};

function response(body: unknown) {
  return Response.json(body);
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("student P1 real dashboard", () => {
  it("separates checkpoint, submission, feedback and teacher acceptance from playback", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/teaching/courses") return response(membershipBody);
      return response({
        courses: [{
          courseId: "course-1",
          courseTitle: "真实课程",
          classId: "class-1",
          units: [
            { lessonKey: "lesson-1", position: 1, activityId: "activity-1", formative: { attempted: true }, submission: { state: "revision_requested" }, feedback: { status: "revision-required" }, completion: { completed: false, basis: "teacher-accepted-current-version" } },
            { lessonKey: "lesson-2", position: 2, activityId: "activity-2", formative: { attempted: true }, submission: { state: "submitted" }, feedback: { status: "awaiting-teacher" }, completion: { completed: false, basis: "teacher-accepted-current-version" } },
            { lessonKey: "lesson-3", position: 3, activityId: "activity-3", formative: { attempted: true }, submission: { state: "accepted" }, feedback: { status: "accepted" }, completion: { completed: true, basis: "teacher-accepted-current-version" } },
          ],
          counts: { notStarted: 0, draft: 0, submitted: 1, revisionRequested: 1, resubmitted: 0, accepted: 1, completedUnits: 1, overdue: 0 },
          nextAction: { type: "revise-submission", lessonKey: "lesson-1", reasonCode: "revision-requested" },
          playbackProgress: { status: "not-authoritative", percent: null },
          projectionVersion: 9,
          dataFreshAt: "2026-08-21T01:00:00.000Z",
        }],
        nextAction: { type: "revise-submission", lessonKey: "lesson-1", reasonCode: "revision-requested" },
        dataFreshAt: "2026-08-21T01:00:00.000Z",
      });
    }));

    const { container } = render(<StudentDashboardPage />);
    await waitFor(() => expect(container.querySelector("[data-uais-real-learning-dashboard='true']")).toBeTruthy());
    const realDashboard = within(container.querySelector("[data-uais-real-learning-dashboard='true']") as HTMLElement);

    expect(realDashboard.getAllByText("优先修订学习产物").length).toBeGreaterThan(0);
    expect(realDashboard.getAllByText("独立记录，非完成依据").length).toBe(3);
    expect(realDashboard.getByText("已发布修订反馈")).toBeTruthy();
    expect(realDashboard.getByText("等待教师")).toBeTruthy();
    expect(realDashboard.getAllByText("教师已接受").length).toBeGreaterThan(0);
    expect(realDashboard.getByText(/projection V9/)).toBeTruthy();
    expect(screen.queryByText(/继续观看康霞博士/)).toBeNull();
  });

  it("shows an honest empty state when approved courses have no published P1 activity", async () => {
    window.history.replaceState(null, "", "/student-dashboard");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/teaching/courses" ? response(membershipBody) : response({ courses: [{ courseId: "course-1", courseTitle: "真实课程", classId: "class-1", units: [], counts: { notStarted: 0, draft: 0, submitted: 0, revisionRequested: 0, resubmitted: 0, accepted: 0, completedUnits: 0, overdue: 0 }, nextAction: { type: "collect-more-evidence", reasonCode: "no-published-learning-units" }, playbackProgress: { status: "not-authoritative", percent: null }, projectionVersion: 0, dataFreshAt: "2026-08-21T01:00:00.000Z" }], nextAction: { type: "collect-more-evidence", reasonCode: "no-published-learning-units" }, dataFreshAt: "2026-08-21T01:00:00.000Z" })));

    render(<StudentDashboardPage />);
    expect(await screen.findByText(/不会显示虚构待办或完成度/)).toBeTruthy();
  });
});
