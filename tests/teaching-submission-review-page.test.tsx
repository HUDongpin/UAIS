import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingSubmissionReviewPage } from "@/components/pages/teaching-submission-review-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({ locale: "zh-CN" }),
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function detail(phase: "initial" | "ai" | "decided" = "initial") {
  const aiDraft = {
    id: "feedback-draft-1",
    submissionVersionId: "version-1",
    origin: "ai-assisted",
    status: "draft",
    rubricJudgments: { claim: "met", evidence: "partly-met", reasoning: "needs-revision" },
    feedbackText: "AI 草稿，尚未由教师确认。",
    requiresRevision: false,
    sourceDraftRevision: 1,
    aiAssisted: true,
  };
  const released = {
    ...aiDraft,
    id: "feedback-released-1",
    status: "released",
    feedbackText: "教师修改后反馈。",
    requiresRevision: true,
  };
  return {
    id: "submission-1",
    state: phase === "decided" ? "revision_requested" : "submitted",
    currentVersionNo: 1,
    currentVersionId: "version-1",
    student: { account: "student-1", displayName: "学生甲" },
    courseId: "course-1",
    classId: "class-1",
    activityId: "activity-1",
    lessonKey: "lesson-1",
    activity: {
      title: { "zh-CN": "论证任务", "en-US": "Argument task" },
      instructions: { "zh-CN": "提交证据论证。", "en-US": "Submit an evidence argument." },
      aiPolicy: "teacher-requested-draft",
      rubric: [
        { id: "claim", label: { "zh-CN": "主张", "en-US": "Claim" } },
        { id: "evidence", label: { "zh-CN": "证据", "en-US": "Evidence" } },
        { id: "reasoning", label: { "zh-CN": "推理", "en-US": "Reasoning" } },
      ],
    },
    formative: { attempted: true, attemptCount: 1 },
    versions: [{ id: "version-1", versionNo: 1, status: "sealed", contentText: "学生封存的 V1 正文", draftRevision: 2 }],
    feedback: phase === "ai" ? [aiDraft] : phase === "decided" ? [released] : [],
    dataFreshAt: "2026-08-21T01:00:00.000Z",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TeachingSubmissionReviewPage", () => {
  it("binds an AI draft to the sealed version, then releases an edited revision decision", async () => {
    let phase: "initial" | "ai" | "decided" = "initial";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/ai-feedback-draft")) {
        phase = "ai";
        return json({ status: "persisted", receipt: { state: "draft" } });
      }
      if (init?.method === "POST" && url.endsWith("/decision")) {
        phase = "decided";
        return json({ status: "persisted", receipt: { state: "revision_requested" } });
      }
      return json({ submission: detail(phase) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeachingSubmissionReviewPage submissionId="submission-1" />);

    expect(await screen.findByText("学生封存的 V1 正文")).toBeTruthy();
    expect(screen.queryByText("AI 草稿，尚未由教师确认。")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /按需生成 AI 草稿/ }));
    const feedbackBox = await screen.findByRole("textbox", { name: "教师确认反馈" });
    await waitFor(() => expect(feedbackBox).toHaveProperty("value", "AI 草稿，尚未由教师确认。"));
    expect(screen.getByText(/AI 辅助 · 教师必须确认/)).toBeTruthy();

    fireEvent.change(feedbackBox, { target: { value: "教师修改后反馈。" } });
    fireEvent.click(screen.getByRole("button", { name: "发布反馈并要求修订" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/submissions/submission-1/decision",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedSubmissionVersionId: "version-1",
          decision: "request-revision",
          feedbackText: "教师修改后反馈。",
          rubricJudgments: { claim: "met", evidence: "partly-met", reasoning: "needs-revision" },
          origin: "ai-assisted",
        }),
      }),
    ));
    expect(await screen.findByText(/等待学生提交新版本/)).toBeTruthy();
    expect(screen.getByText("教师修改后反馈。")).toBeTruthy();
  });

  it("keeps the manual path usable when the AI provider is unavailable", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/ai-feedback-draft")) {
        return json({ status: "failed", reasonCode: "ai-feedback-disabled" }, 503);
      }
      if (init?.method === "PUT" && url.endsWith("/feedback")) {
        return json({ status: "persisted", receipt: { state: "draft" } });
      }
      return json({ submission: detail("initial") });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeachingSubmissionReviewPage submissionId="submission-1" />);

    await screen.findByText("学生封存的 V1 正文");
    fireEvent.click(screen.getByRole("button", { name: /按需生成 AI 草稿/ }));
    expect(await screen.findByText(/不会自动重试或发布/)).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "教师确认反馈" }), { target: { value: "人工反馈仍可使用。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存教师草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/teaching/submissions/submission-1/feedback",
      expect.objectContaining({ method: "PUT" }),
    ));
  });
});
