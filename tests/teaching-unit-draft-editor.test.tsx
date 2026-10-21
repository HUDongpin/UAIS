import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TeachingOperationPage } from "@/components/teaching/teaching-operation-page";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingUnitDraftEditor, readVerifiedTeachingUnitDraft } from "@/components/teaching/teaching-unit-draft-editor";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/providers/app-preferences", () => ({ useAppPreferences: () => ({ locale: "zh-CN", theme: "light" }) }));

const content = {
  title: "比较研究中的变量与证据",
  objectives: ["区分研究问题中的自变量和因变量，并用给定案例解释选择。"],
  activities: [{ title: "案例比较", durationMinutes: 15, instructions: "阅读两个课堂案例，小组标注变量，写出可检验的问题并互相解释证据。" }],
  lectureScript: "今天我们用两个案例来辨认变量。先找出研究者改变的条件，再判断观察到的结果。请比较两个案例的共同点，并解释控制条件如何影响结论。最后用自己的语言提出一个可检验的问题。",
  questions: [{ prompt: "案例中研究者改变学习时长并观察成绩，哪一个是因变量？请说明理由。", referenceAnswer: "成绩是因变量，因为它是研究者在改变学习时长之后测量的结果。" }],
};
function draft(overrides: Record<string, unknown> = {}) {
  return { courseId: "course-a", unitDraftId: "draft-a", operationRecordId: "operation-a", draftStatus: "generated", content, revision: 1, generatedAt: "2026-10-20T01:00:00.000Z", ...overrides };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("TeachingUnitDraftEditor", () => {
  it("rejects an image when browser decoding fails without adding it to the draft", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("Invalid image"); }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ unitDraft: draft() })));
    render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "媒体页标题" }), { target: { value: "Broken image" } });
    fireEvent.change(screen.getByLabelText("媒体页图片"), { target: { files: [new File([new Uint8Array([137,80,78,71])], "bad.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "添加媒体页" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Broken image" })).toBeNull();
    expect((screen.getByRole("button", { name: "保存单元正文" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("adds an uploaded private image, saves it and restores it after reopening", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
    let saved = draft();
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") saved = draft({ content: JSON.parse(String(init.body)).content, revision: 2 });
      return Response.json({ unitDraft: saved });
    }));
    const view = render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" />);
    await screen.findByRole("textbox", { name: "媒体页标题" });
    fireEvent.change(screen.getByRole("textbox", { name: "媒体页标题" }), { target: { value: "QA private image" } });
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNQKe8GAAHpASfBfuXbAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));
    fireEvent.change(screen.getByLabelText("媒体页图片"), { target: { files: [new File([bytes], "qa.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "添加媒体页" }));
    expect(await screen.findByRole("img", { name: "QA private image" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存单元正文" }));
    await screen.findByText("单元正文已保存，仍需教师审核后发布。");
    view.unmount();
    render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" />);
    expect(await screen.findByRole("img", { name: "QA private image" })).toBeTruthy();
  });

  it("shows generation success only after canonical body readback and allows saving the generated content", async () => {
    let generated = false;
    let saved = draft();
    let completeReadback = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/unit-draft")) {
        if (!generated) return Response.json({}, { status: 404 });
        if (init?.method === "PATCH") {
          const patch = JSON.parse(String(init.body));
          saved = draft({ content: patch.content, revision: 2 });
        }
        completeReadback = true;
        return Response.json({ unitDraft: saved });
      }
      if (url === "/api/teaching/operations") {
        expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({ courseId: "course-a", operationId: "content", actionSlot: "secondary", locale: "zh-CN" }));
        generated = true;
        return Response.json({
          receipt: { receiptId: "operation-a", courseId: "course-a", operationId: "content", actionSlot: "secondary", status: "persisted", displayMessage: { "zh-CN": "单元草稿已生成，等待教师校订。", "en-US": "Unit draft ready for review." } },
          traceId: "trace-a",
          domainPersistenceSummary: { required: true, status: "persisted", operationReceiptId: "operation-a", expectedObjectTypes: ["unit-draft"], persistedObjectTypes: ["unit-draft"], missingObjectTypes: [] },
        });
      }
      expect(url).toBe("/api/teaching/operations/audit");
      return Response.json({
        records: [{ recordId: "operation-a", courseId: "course-a" }],
        auditEvents: [{ traceId: "trace-a", courseId: "course-a", authSession: { sessionId: "signed-session", authenticatedAt: "2026-10-20T00:00:00Z", expiresAt: "2026-10-20T10:00:00Z" } }],
        domainProjections: [{ objectId: "projection-a", objectType: "unit-draft", courseId: "course-a", operationRecordId: "operation-a", draftStatus: "ready-for-teacher-review", reviewPolicy: "teacher-review-before-course-publish", generatedBy: "teacher-a", artifactId: "artifact-a", generatedAt: "2026-10-20T01:00:00Z" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TeachingOperationPage operationId="content" selectedCourseId="course-a" />);
    await screen.findByText("尚无单元草稿，请先生成。");
    fireEvent.click(screen.getByRole("button", { name: "生成单元草稿" }));
    expect(await screen.findByText("单元草稿已生成，等待教师校订。")).toBeTruthy();
    expect(completeReadback).toBe(true);
    fireEvent.change(await screen.findByRole("textbox", { name: "教学讲稿" }), { target: { value: `${content.lectureScript} 教师补充：请明确每项变量的测量方法。` } });
    fireEvent.click(screen.getByRole("button", { name: "保存单元正文" }));
    expect(await screen.findByText("单元正文已保存，仍需教师审核后发布。")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("loads teaching content, saves edits with the revision, and restores them on reopening", async () => {
    let saved = draft();
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body));
        expect(patch.expectedRevision).toBe(1);
        saved = draft({ content: patch.content, revision: 2 });
      }
      return Response.json({ unitDraft: saved });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" expectedOperationRecordId="operation-a" />);
    expect(await screen.findByRole("textbox", { name: "单元标题" })).toHaveProperty("value", content.title);
    expect(screen.getByRole("textbox", { name: "教学讲稿" })).toHaveProperty("value", content.lectureScript);
    fireEvent.change(screen.getByRole("textbox", { name: "单元标题" }), { target: { value: "教师修订的变量研究单元" } });
    fireEvent.click(screen.getByRole("button", { name: "保存单元正文" }));
    expect(await screen.findByText("单元正文已保存，仍需教师审核后发布。" )).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "单元标题" }), { target: { value: "尚未保存的第二次修改" } });
    expect(screen.queryByText("单元正文已保存，仍需教师审核后发布。")).toBeNull();
    view.unmount();
    render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" />);
    expect(await screen.findByRole("textbox", { name: "单元标题" })).toHaveProperty("value", "教师修订的变量研究单元");
    expect(fetchMock.mock.calls.every(([url]) => String(url) === "/api/teaching/courses/course-a/unit-draft")).toBe(true);
  });

  it("preserves local edits on a revision conflict without claiming save success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "PATCH" ? Response.json({ error: "conflict" }, { status: 409 }) : Response.json({ unitDraft: draft() })));
    render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "单元标题" }), { target: { value: "保留教师尚未保存的修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存单元正文" }));
    expect(await screen.findByText("草稿已被其他操作更新。你的修改已保留，请复制修改后重新打开草稿。" )).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "单元标题" })).toHaveProperty("value", "保留教师尚未保存的修改");
    expect(screen.queryByText("单元正文已保存，仍需教师审核后发布。")).toBeNull();
  });

  it("discards a late readback after switching courses", async () => {
    let resolveFirst!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => String(url).includes("course-a") ? new Promise<Response>((resolve) => { resolveFirst = resolve; }) : Response.json({ unitDraft: draft({ courseId: "course-b", unitDraftId: "draft-b", content: { ...content, title: "第二门课程的正文" } }) })));
    const view = render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" />);
    view.rerender(<TeachingUnitDraftEditor courseId="course-b" locale="zh-CN" />);
    expect(await screen.findByRole("textbox", { name: "单元标题" })).toHaveProperty("value", "第二门课程的正文");
    await act(async () => { resolveFirst(Response.json({ unitDraft: draft() })); });
    expect(screen.getByRole("textbox", { name: "单元标题" })).toHaveProperty("value", "第二门课程的正文");
  });

  it.each([
    { content: undefined },
    { courseId: "another-course" },
    { operationRecordId: "another-generation" },
    { draftStatus: "incomplete" },
  ])("rejects incomplete or mismatched canonical readback: %j", async (overrides) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ unitDraft: draft(overrides) })));
    await expect(readVerifiedTeachingUnitDraft("course-a", "operation-a")).rejects.toThrow();
  });

  it("shows a metadata-only legacy record as incomplete without editable content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ unitDraft: draft({ content: undefined, draftStatus: "incomplete" }) })));
    render(<TeachingUnitDraftEditor courseId="course-a" locale="zh-CN" />);
    await waitFor(() => expect(screen.getByText("尚未读回完整教学正文，请重新生成单元草稿。" )).toBeTruthy());
    expect(screen.queryByRole("button", { name: "保存单元正文" })).toBeNull();
  });
});
