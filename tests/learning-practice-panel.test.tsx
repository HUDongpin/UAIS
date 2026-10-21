import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function scopedPanel(requestedActivityId: string) {
  return <SessionUserProvider initialSessionUser={{ account: "student-a@example.test", role: "student", displayName: "P1 Student", department: "Acceptance" }}>
    <LearningPracticePanel locale="zh-CN" courseId="course-1" classId="class-1" lessonKey="lesson-1" requestedActivityId={requestedActivityId} signInHref="/login" />
  </SessionUserProvider>;
}

function scopedUnit(activityId: string) {
  const result = unitResponse();
  result.activity.id = activityId;
  result.activity.title["zh-CN"] = `任务 ${activityId}`;
  result.submission.currentVersion.contentText = `服务端 ${activityId}`;
  return result;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("LearningPracticePanel", () => {
  it.each(["version", "revision", "legacy"])("does not adopt fresh server tokens for an older %s recovery draft", async (change) => {
    let remote = unitResponse();
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method) return jsonResponse({ status: "persisted", revision: 3, submissionVersionId: remote.submission.currentVersion.id });
      return jsonResponse(remote);
    });
    vi.stubGlobal("fetch", fetchMock);
    let rendered = render(scopedPanel("activity-1"));
    await screen.findByRole("heading", { name: "证据论证" });
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "Unsent work from old base" } });
    rendered.unmount();
    remote = unitResponse();
    if (change === "version") remote.submission.currentVersion.id = "version-two";
    if (change === "revision") remote.submission.currentVersion.draftRevision = 2;
    remote.submission.currentVersion.contentText = "New server work";
    if (change === "legacy") {
      const key = "uais:p1:draft-recovery:v2:student-a%40example.test:course-1:class-1:activity-1";
      const envelope = JSON.parse(window.localStorage.getItem(key)!);
      envelope.version = 2;
      delete envelope.base;
      window.localStorage.setItem(key, JSON.stringify(envelope));
    }
    // An unresolved conflict must retain its original base across another reload.
    for (let reload = 0; reload < 2; reload += 1) {
      rendered = render(scopedPanel("activity-1"));
      await screen.findByRole("heading", { name: "证据论证" });
      expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("value", "Unsent work from old base");
      expect(screen.getByRole("button", { name: "复制本机文字" })).toBeTruthy();
      expect(Boolean(screen.queryByRole("button", { name: "显式合并两份文字" }))).toBe(change === "revision");
      vi.useFakeTimers();
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
      vi.useRealTimers();
      rendered.unmount();
    }
  });

  it.each(["initial", "same-version"])("continues %s recovery only when its original base still matches", async (kind) => {
    const initial = unitResponse({ ...(kind === "initial" ? { submission: undefined } : {}) });
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => init?.method
      ? jsonResponse({ status: "persisted", revision: 2, submissionVersionId: "saved-version" })
      : jsonResponse(initial));
    vi.stubGlobal("fetch", fetchMock);
    let rendered = render(scopedPanel("activity-1"));
    await screen.findByRole("heading", { name: "证据论证" });
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "Recoverable local work" } });
    rendered.unmount();
    vi.useFakeTimers();
    rendered = render(scopedPanel("activity-1"));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("value", "Recoverable local work");
    expect(screen.queryByRole("button", { name: "复制本机文字" })).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    const write = fetchMock.mock.calls.find(([, init]) => init?.method);
    expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({ expectedSubmissionVersionId: kind === "initial" ? null : "version-1", expectedDraftRevision: kind === "initial" ? 0 : 1 });
    rendered.unmount();
  });

  it.each(["first", "revision"])("carries the created %s draft version into subsequent save and submit", async (kind) => {
    const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
    const base = unitResponse();
    const initial = unitResponse({ submission: kind === "first" ? undefined : { ...base.submission, state: "revision_requested" } });
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (!init?.method) return jsonResponse(initial);
      writes.push({ method: init.method, body: JSON.parse(String(init.body)) });
      return jsonResponse({ status: "persisted", revision: writes.length, submissionVersionId: "created-version" });
    });
    await renderLoadedPanel(fetchMock);
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "New draft" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(writes[0]?.body).toMatchObject({ expectedDraftRevision: 0, expectedSubmissionVersionId: kind === "first" ? null : "version-1" });
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "More draft" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(writes[1]?.body).toMatchObject({ expectedDraftRevision: 1, expectedSubmissionVersionId: "created-version" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: kind === "first" ? "封存并提交" : "提交新版本" })));
    expect(writes[2]).toEqual({ method: "POST", body: { expectedDraftRevision: 2, expectedSubmissionVersionId: "created-version" } });
  });

  it.each(["save", "submit"])("keeps local text after a cross-version %s conflict until explicit server reload", async (operation) => {
    const next = unitResponse();
    next.submission.currentVersion.id = "version-two";
    next.submission.currentVersion.contentText = "Latest version-two work";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse()))
      .mockResolvedValueOnce(jsonResponse({ reasonCode: "stale-submission-version", latestSubmissionVersionId: "version-two", latestRevision: 1, latestContent: "Latest version-two work" }, 409))
      .mockResolvedValueOnce(jsonResponse(next))
      .mockResolvedValueOnce(jsonResponse({ status: "persisted", revision: 2, submissionVersionId: "version-two" }));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderLoadedPanel(fetchMock);
    vi.useFakeTimers();
    if (operation === "save") {
      fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "Old version local edits" } });
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
    } else {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "封存并提交" })));
    }
    expect(screen.getByText(/提交版本已在另一设备上改变/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "显式合并两份文字" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "Newest local edits after conflict" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "复制本机文字" }));
    expect(writeText).toHaveBeenCalledWith("Newest local edits after conflict");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "使用服务端版本" })));
    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("value", "Latest version-two work");
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "Reviewed version-two work" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({ expectedSubmissionVersionId: "version-two", expectedDraftRevision: 1 });
  });

  it("reads and saves the explicitly selected activity", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(scopedUnit("activity-b"))).mockResolvedValueOnce(jsonResponse({ status: "persisted", revision: 2, submissionVersionId: "version-1" }));
    vi.stubGlobal("fetch", fetchMock);
    render(scopedPanel("activity-b"));
    await screen.findByRole("heading", { name: "任务 activity-b" });
    expect(fetchMock).toHaveBeenCalledWith("/api/learning/courses/course-1/units/lesson-1?activityId=activity-b", expect.anything());
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "B draft" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/learning/activities/activity-b/submission", expect.objectContaining({ method: "PUT", body: JSON.stringify({ contentText: "B draft", expectedDraftRevision: 1, expectedSubmissionVersionId: "version-1" }) }));
  });

  it("accepts the canonical server UUID for an uppercase or padded task selector", async () => {
    const activityId = "abcdef12-abcd-4abc-8abc-abcdef123456";
    const requested = ` ${activityId.toUpperCase()} `;
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(scopedUnit(activityId)));
    vi.stubGlobal("fetch", fetchMock);
    render(scopedPanel(requested));
    expect(await screen.findByRole("heading", { name: `任务 ${activityId}` })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/learning/courses/course-1/units/lesson-1?activityId=${encodeURIComponent(requested)}`, expect.anything());
  });

  it("does not fall back to another activity when an explicit selection is mismatched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(scopedUnit("activity-a"))));
    render(scopedPanel("activity-b"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("暂时无法读取真实学习任务"));
    expect(screen.queryByRole("textbox", { name: "学习产物正文" })).toBeNull();
  });

  it("ignores a late activity read and keeps unsaved drafts scoped while switching tasks", async () => {
    let finishFirstRead!: (response: Response) => void;
    let first = true;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (init?.method) throw new Error("No background write should cross an activity switch.");
      if (first) { first = false; return new Promise<Response>((resolve) => { finishFirstRead = resolve; }); }
      return Promise.resolve(jsonResponse(scopedUnit(input.includes("activity-b") ? "activity-b" : "activity-a")));
    });
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(scopedPanel("activity-a"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rendered.rerender(scopedPanel("activity-b"));
    await screen.findByRole("heading", { name: "任务 activity-b" });
    await act(async () => finishFirstRead(jsonResponse(scopedUnit("activity-a"))));
    expect(screen.getByRole("heading", { name: "任务 activity-b" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "Unsent B" } });
    rendered.rerender(scopedPanel("activity-a"));
    await screen.findByRole("heading", { name: "任务 activity-a" });
    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("value", "服务端 activity-a");
    rendered.rerender(scopedPanel("activity-b"));
    await screen.findByRole("heading", { name: "任务 activity-b" });
    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("value", "Unsent B");
    expect(fetchMock.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.method)).toBe(true);
    rendered.unmount();
  });

  it("does not carry a late save revision into another activity editor", async () => {
    let finishSave!: (response: Response) => void;
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (init?.method === "PUT" && input.includes("activity-a")) return new Promise<Response>((resolve) => { finishSave = resolve; });
      if (init?.method === "PUT") return Promise.resolve(jsonResponse({ status: "persisted", revision: 2, submissionVersionId: "version-1" }));
      return Promise.resolve(jsonResponse(scopedUnit(input.includes("activity-b") ? "activity-b" : "activity-a")));
    });
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(scopedPanel("activity-a"));
    await screen.findByRole("heading", { name: "任务 activity-a" });
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "A pending save" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    vi.useRealTimers();
    rendered.rerender(scopedPanel("activity-b"));
    await screen.findByRole("heading", { name: "任务 activity-b" });
    await act(async () => finishSave(jsonResponse({ status: "persisted", revision: 7, submissionVersionId: "version-1" })));
    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("value", "服务端 activity-b");
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "B own save" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/learning/activities/activity-b/submission", expect.objectContaining({ body: JSON.stringify({ contentText: "B own save", expectedDraftRevision: 1, expectedSubmissionVersionId: "version-1" }) }));
  });

  it("shows checkpoint persistence failures alongside the loaded activity", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse({ formative: { attempted: false }, submission: undefined })))
      .mockResolvedValueOnce(jsonResponse({ reasonCode: "persistence-unavailable" }, 503));
    await renderLoadedPanel(fetchMock);
    fireEvent.change(screen.getByRole("textbox", { name: "形成性检查回答" }), { target: { value: "我的检查回答" } });
    fireEvent.click(screen.getByRole("button", { name: "提交检查" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "形成性检查尚未保存，请重试。");
    expect(screen.getByRole("textbox", { name: "形成性检查回答" })).toHaveProperty("value", "我的检查回答");
  });

  it("lets the learner retry a failed autosave without altering the retained text", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse()))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse({ status: "persisted", revision: 2, submissionVersionId: "version-1" }));
    await renderLoadedPanel(fetchMock);
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole("textbox", { name: "学习产物正文" }), { target: { value: "网络恢复后重试同一份文字" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("button", { name: "封存并提交" })).toHaveProperty("disabled", true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "重试保存" })));
    expect(screen.getByText("已由服务端保存")).toBeTruthy();
    expect(screen.getByRole("button", { name: "封存并提交" })).toHaveProperty("disabled", false);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/learning/activities/activity-1/submission",
      expect.objectContaining({ body: JSON.stringify({ contentText: "网络恢复后重试同一份文字", expectedDraftRevision: 1, expectedSubmissionVersionId: "version-1" }) }),
    );
  });

  it("retries the newest text after a slower earlier save fails", async () => {
    let failSave!: (reason: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse()))
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { failSave = reject; }))
      .mockResolvedValueOnce(jsonResponse({ status: "persisted", revision: 2, submissionVersionId: "version-1" }));
    await renderLoadedPanel(fetchMock);
    vi.useFakeTimers();
    const evidence = screen.getByRole("textbox", { name: "学习产物正文" });
    fireEvent.change(evidence, { target: { value: "较早的保存请求" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    fireEvent.change(evidence, { target: { value: "保存期间继续编辑的新正文" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => failSave(new TypeError("offline")));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "重试保存" })));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/learning/activities/activity-1/submission",
      expect.objectContaining({ body: JSON.stringify({ contentText: "保存期间继续编辑的新正文", expectedDraftRevision: 1, expectedSubmissionVersionId: "version-1" }) }),
    );
    expect(evidence).toHaveProperty("value", "保存期间继续编辑的新正文");
    expect(screen.getByRole("button", { name: "封存并提交" })).toHaveProperty("disabled", false);
  });

  it("copies and merges the latest editor text when an earlier save conflicts", async () => {
    let finishSave!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve; }))
      .mockResolvedValueOnce(jsonResponse({ status: "persisted", revision: 6, submissionVersionId: "version-1" }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await renderLoadedPanel(fetchMock);
    vi.useFakeTimers();
    const evidence = screen.getByRole("textbox", { name: "学习产物正文" });
    fireEvent.change(evidence, { target: { value: "A" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    fireEvent.change(evidence, { target: { value: "A+B" } });
    await act(async () => finishSave(jsonResponse({
      reasonCode: "stale-draft-revision", latestRevision: 5, latestContent: "Server draft",
    }, 409)));
    fireEvent.click(screen.getByRole("button", { name: "复制本机文字" }));
    expect(writeText).toHaveBeenLastCalledWith("A+B");

    fireEvent.change(evidence, { target: { value: "A+B+C" } });
    fireEvent.click(screen.getByRole("button", { name: "复制本机文字" }));
    expect(writeText).toHaveBeenLastCalledWith("A+B+C");
    fireEvent.click(screen.getByRole("button", { name: "显式合并两份文字" }));
    const merged = "Server draft\n\n---\n\nA+B+C";
    expect(evidence).toHaveProperty("value", merged);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/learning/activities/activity-1/submission",
      expect.objectContaining({ body: JSON.stringify({ contentText: merged, expectedDraftRevision: 5, expectedSubmissionVersionId: "version-1" }) }),
    );
  });

  it("still lets the learner explicitly replace local edits with the server draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unitResponse()))
      .mockResolvedValueOnce(jsonResponse({ reasonCode: "stale-draft-revision", latestRevision: 5, latestContent: "Server draft" }, 409));
    await renderLoadedPanel(fetchMock);
    vi.useFakeTimers();
    const evidence = screen.getByRole("textbox", { name: "学习产物正文" });
    fireEvent.change(evidence, { target: { value: "Local draft" } });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    fireEvent.change(evidence, { target: { value: "More local edits" } });
    fireEvent.click(screen.getByRole("button", { name: "使用服务端版本" }));
    expect(evidence).toHaveProperty("value", "Server draft");
    expect(screen.queryByRole("button", { name: "显式合并两份文字" })).toBeNull();
    expect(screen.getByRole("button", { name: "封存并提交" })).toHaveProperty("disabled", false);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

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
      .mockResolvedValueOnce(jsonResponse({ status: "persisted", revision: 2, submissionVersionId: "version-1" }));
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
          expectedDraftRevision: 1, expectedSubmissionVersionId: "version-1",
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

  it("shows sealed server evidence instead of an older unsent recovery draft", async () => {
    const storageKey = "uais:p1:draft-recovery:v2:student-a%40example.test:course-1:class-1:activity-1";
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 2,
      scope: { learnerAccount: "student-a@example.test", courseId: "course-1", classId: "class-1", activityId: "activity-1" },
      contentText: "未提交的本机文字",
      updatedAt: Date.now(),
    }));
    const accepted = unitResponse();
    accepted.submission.state = "accepted";
    accepted.submission.currentVersion.status = "sealed";
    accepted.submission.currentVersion.contentText = "教师接受的封存正文";
    await renderLoadedPanel(vi.fn().mockResolvedValueOnce(jsonResponse(accepted)));

    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("value", "教师接受的封存正文");
    expect(screen.getByRole("textbox", { name: "学习产物正文" })).toHaveProperty("readOnly", true);
    expect(screen.queryByText("已恢复本机未提交文字")).toBeNull();
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
