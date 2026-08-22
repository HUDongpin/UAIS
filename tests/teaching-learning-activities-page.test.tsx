import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingLearningActivitiesPage } from "@/components/pages/teaching-learning-activities-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({ locale: "zh-CN" }),
}));

const activity = {
  id: "activity-1",
  activityKey: "activity-1",
  version: 1,
  editRevision: 1,
  status: "draft",
  lessonKey: "lesson-1",
  lessonPosition: 1,
  targetClassId: "class-1",
  title: { "zh-CN": "真实论证任务", "en-US": "Real argument activity" },
  instructions: { "zh-CN": "提交论证。", "en-US": "Submit an argument." },
  rubric: [
    { id: "claim", label: { "zh-CN": "主张", "en-US": "Claim" } },
    { id: "evidence", label: { "zh-CN": "证据", "en-US": "Evidence" } },
    { id: "reasoning", label: { "zh-CN": "推理", "en-US": "Reasoning" } },
  ],
  checkpoint: {
    kind: "short-answer",
    prompt: { "zh-CN": "什么是证据？", "en-US": "What is evidence?" },
    explanation: { "zh-CN": "证据支持主张。", "en-US": "Evidence supports a claim." },
  },
  aiPolicy: "teacher-requested-draft",
  revisionPolicy: "teacher-requested",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TeachingLearningActivitiesPage", () => {
  it("renders real activities and insights, then publishes with server readback", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return json({ status: "persisted", activity: { ...activity, status: "published", editRevision: 2 } });
      }
      if (url === "/api/teaching/courses") {
        return json({ classes: [{ courseId: "course-1", classId: "class-1", className: "一班" }] });
      }
      if (url.includes("/api/learning/ppt-playback/")) {
        return json({ playback: { learningUnit: { lessonKey: "lesson-1", position: 1 } } });
      }
      if (url.includes("learning-insights")) {
        return json({ counts: { notStarted: 6, draft: 1, submitted: 2, revisionRequested: 3, resubmitted: 4, accepted: 5, overdue: 1 }, projectionVersion: 7, dataFreshAt: "2026-08-21T01:00:00.000Z" });
      }
      if (url.includes("/activities")) {
        return json({ activities: [activity], dataFreshAt: "2026-08-21T01:00:00.000Z" });
      }
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeachingLearningActivitiesPage courseId="course-1" />);

    expect(await screen.findByRole("heading", { name: "真实论证任务" })).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByText("42")).toBeNull();
    expect(screen.getByRole("link", { name: /真实提交队列/ })).toHaveProperty("href", "http://localhost:3000/teaching/activities/activity-1/submissions");

    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/activities/activity-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ operation: "publish", expectedEditRevision: 1 }),
      }),
    ));
    expect(await screen.findByText("状态已由数据库读回确认。")).toBeTruthy();
  });

  it("blocks task authoring with honest messages when no class or published lesson exists", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/teaching/courses") return json({ classes: [] });
      if (url.includes("ppt-playback")) return json({ reasonCode: "published-playback-required" }, 404);
      if (url.includes("learning-insights")) return json({}, 404);
      return json({ activities: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeachingLearningActivitiesPage courseId="course-1" />);

    expect(await screen.findByText(/尚无可绑定的已发布课件单元/)).toBeTruthy();
    expect(screen.getByText(/尚无真实班级/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存任务草稿" })).toHaveProperty("disabled", true);
  });
});
