import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningPracticePanel } from "@/components/pages/learning-practice-panel";
import { SessionUserProvider } from "@/components/providers/session-user";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unitResponse(overrides: Record<string, unknown> = {}) {
  return {
    unit: { courseId: "course-1", classId: "class-1", lessonKey: "lesson-1" },
    activity: {
      id: "activity-1",
      status: "published",
      title: { "zh-CN": "证据论证", "en-US": "Evidence argument" },
      instructions: { "zh-CN": "写出你的论证。", "en-US": "Write your argument." },
      rubric: [
        { id: "claim", label: { "zh-CN": "主张", "en-US": "Claim" } },
        { id: "evidence", label: { "zh-CN": "证据", "en-US": "Evidence" } },
        { id: "reasoning", label: { "zh-CN": "推理", "en-US": "Reasoning" } },
      ],
      checkpoint: {
        kind: "short-answer",
        prompt: { "zh-CN": "证据是什么？", "en-US": "What is evidence?" },
      },
    },
    formative: { attempted: true, attemptCount: 1 },
    submission: {
      id: "submission-1",
      state: "draft",
      currentVersion: {
        id: "version-1",
        status: "draft",
        contentText: "服务端草稿",
        draftRevision: 1,
      },
    },
    feedback: [],
    completion: { completed: false, basis: "teacher-accepted-current-version" },
    ...overrides,
  };
}

async function renderLoadedPanel(
  fetchMock: ReturnType<typeof vi.fn>,
  learnerAccount = "student-a@example.test",
) {
  vi.stubGlobal("fetch", fetchMock);
  render(
    <SessionUserProvider
      initialSessionUser={{
        account: learnerAccount,
        role: "student",
        displayName: "P1 Student",
        department: "Acceptance",
      }}
    >
      <LearningPracticePanel
        locale="zh-CN"
        courseId="course-1"
        classId="class-1"
        lessonKey="lesson-1"
        signInHref="/login?returnTo=%2Flearning"
      />
    </SessionUserProvider>,
  );
  expect(await screen.findByRole("heading", { name: "证据论证" })).toBeTruthy();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("LearningPracticePanel", () => {
  it("shows an honest empty state when no approved real unit is available", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LearningPracticePanel locale="zh-CN" signInHref="/login" />);

    expect(screen.getByText(/不会显示虚构待交作业/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("autosaves only after the server persists the next draft revision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse()))
      .mockResolvedValueOnce(jsonResponse({ status: "persisted", revision: 2 }));
    await renderLoadedPanel(fetchMock);

    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), {
      target: { value: "本机的新论证" },
    });
    expect(screen.getByText("等待自动保存")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText("已由服务端保存")).toBeTruthy();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/learning/activities/activity-1/submission",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          contentText: "本机的新论证",
          expectedDraftRevision: 1,
        }),
      }),
    );
    expect(
      window.localStorage.getItem(
        "uais:p1:draft-recovery:v2:student-a%40example.test:course-1:class-1:activity-1",
      ),
    ).toBeNull();
  });

  it("discards the legacy activity-only draft instead of exposing it to another account", async () => {
    window.localStorage.setItem(
      "uais:p1:draft-recovery:activity-1",
      "student A private draft",
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(unitResponse()));

    await renderLoadedPanel(fetchMock, "student-b@example.test");

    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty(
      "value",
      "服务端草稿",
    );
    expect(
      window.localStorage.getItem("uais:p1:draft-recovery:activity-1"),
    ).toBeNull();
  });

  it("recovers a draft only from the matching account, course, class and activity scope", async () => {
    const storageKey =
      "uais:p1:draft-recovery:v2:student-a%40example.test:course-1:class-1:activity-1";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        scope: {
          learnerAccount: "student-a@example.test",
          courseId: "course-1",
          classId: "class-1",
          activityId: "activity-1",
        },
        contentText: "student A scoped recovery",
        updatedAt: Date.now(),
      }),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(unitResponse()));

    await renderLoadedPanel(fetchMock, "student-a@example.test");

    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty(
      "value",
      "student A scoped recovery",
    );
  });

  it("removes a scoped recovery draft after its seven-day retention window", async () => {
    const storageKey =
      "uais:p1:draft-recovery:v2:student-a%40example.test:course-1:class-1:activity-1";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        scope: {
          learnerAccount: "student-a@example.test",
          courseId: "course-1",
          classId: "class-1",
          activityId: "activity-1",
        },
        contentText: "expired private recovery",
        updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1_000,
      }),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(unitResponse()));

    await renderLoadedPanel(fetchMock, "student-a@example.test");

    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty(
      "value",
      "服务端草稿",
    );
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("preserves both texts on a stale-revision conflict and requires an explicit merge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            status: "conflict",
            reasonCode: "stale-draft-revision",
            latestRevision: 5,
            latestContent: "另一设备的较新文字",
          },
          409,
        ),
      );
    await renderLoadedPanel(fetchMock);

    vi.useFakeTimers();
    const textbox = screen.getByRole("textbox", { name: "学习产物正文" });
    fireEvent.change(textbox, { target: { value: "本机未提交文字" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(screen.getByText(/本机文字未被覆盖/)).toBeTruthy();
    expect(textbox).toHaveProperty("value", "本机未提交文字");
    expect(screen.getByText("另一设备的较新文字")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "显式合并两份文字" }));
    expect(textbox).toHaveProperty(
      "value",
      "另一设备的较新文字\n\n---\n\n本机未提交文字",
    );
  });

  it("never renders unreleased AI drafts returned outside the student contract", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        unitResponse({
          feedback: [
            {
              id: "released-1",
              status: "released",
              feedbackText: "教师已确认的反馈",
            },
          ],
        }),
      ),
    );
    await renderLoadedPanel(fetchMock);

    expect(screen.getByText("教师已确认的反馈")).toBeTruthy();
    expect(screen.queryByText(/AI 原始草稿/)).toBeNull();
  });

  it("keeps archived history readable while disabling every new student write", async () => {
    const archived = unitResponse();
    archived.activity.status = "archived";
    archived.submission.state = "revision_requested";
    archived.feedback = [
      {
        id: "released-1",
        status: "released",
        feedbackText: "请修订，但任务随后由教师归档。",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(archived));
    await renderLoadedPanel(fetchMock);

    expect(screen.getByText(/该任务已归档/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty(
      "readOnly",
      true,
    );
    expect(screen.queryByRole("button", { name: "提交新版本" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
