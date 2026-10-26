import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LessonMaterials } from "@/components/pages/classroom-lesson-materials";
import { TeachingLessonsWorkspace } from "@/components/pages/teaching-lessons-workspace";
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
afterEach(() => vi.unstubAllGlobals());
describe("classroom lesson screens", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "shows the saved draft and the latest release targets/counts separately in %s",
    async (locale) => {
      const lessons = [
        {
          lessonKey: "lesson-1",
          title: "第二版材料",
          position: 1,
          status: "published",
          draftRevision: 4,
          latestVersion: 2,
          draftTaskCount: 3,
          hasUnpublishedDraft: true,
          latestRelease: {
            version: 2,
            draftRevision: 3,
            targetClassIds: ["class-b"],
            publishedTaskCount: 2,
          },
          updatedAt: "2026-10-26T00:00:00Z",
        },
        {
          lessonKey: "lesson-2",
          title: "尚未发布",
          position: 2,
          status: "draft",
          draftRevision: 1,
          latestVersion: 0,
          draftTaskCount: 0,
          hasUnpublishedDraft: true,
          latestRelease: null,
          updatedAt: "2026-10-26T00:00:00Z",
        },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({
            lessons,
            classes: [
              { externalId: "class-a", name: "甲班" },
              { externalId: "class-b", name: "乙班（已更名）" },
            ],
          }),
        ),
      );
      render(<TeachingLessonsWorkspace courseId="course-1" locale={locale} />);
      expect(
        await screen.findByText(
          locale === "zh-CN"
            ? "草稿已更新，尚未发布"
            : "Draft updated; not published yet",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          locale === "zh-CN"
            ? "V2 发布到：乙班（已更名）"
            : "V2 released to: 乙班（已更名）",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          locale === "zh-CN"
            ? "V2 当前已发布任务：2 项（按班级计）"
            : "V2 active published tasks: 2 (counted per class)",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          locale === "zh-CN" ? "草稿任务模板：3 项" : "Draft task templates: 3",
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          locale === "zh-CN"
            ? "尚未发布到班级"
            : "Not released to any class yet",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/V2.*甲班/)).toBeNull();
    },
  );
  it("preserves text entered while an earlier save is pending", async () => {
    let finishSave!: (response: Response) => void;
    const lesson = {
      lessonKey: "lesson-1",
      title: "课时",
      position: 1,
      status: "draft",
      draftRevision: 1,
      latestVersion: 0,
      updatedAt: "2026-10-26T00:00:00Z",
      package: {
        schemaVersion: 1,
        primaryLocale: "zh-CN",
        studentContent: {
          title: "课时",
          objectives: [],
          body: "原正文",
          questions: [],
        },
        teacherGuide: { notes: "", answers: [] },
        tasks: [],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          lesson.package = JSON.parse(String(init.body)).package;
          lesson.draftRevision = 2;
          return new Promise<Response>((resolve) => {
            finishSave = resolve;
          });
        }
        return Response.json(
          url.endsWith("/lesson-1")
            ? { lesson }
            : { lessons: [lesson], classes: [] },
        );
      }),
    );
    render(<TeachingLessonsWorkspace courseId="course-1" locale="zh-CN" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑课时" }));
    const body = await screen.findByRole("textbox", { name: "学生讲解正文" });
    fireEvent.change(body, { target: { value: "已经发送的文字" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    fireEvent.change(body, { target: { value: "保存期间继续输入的新文字" } });
    finishSave(Response.json({ draftRevision: 2 }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存草稿" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(body).toHaveProperty("value", "保存期间继续输入的新文字");
  });
  it("renders a prose lesson without requiring slide images or narration", () => {
    render(
      <LessonMaterials
        content={{
          title: "第一课",
          body: "一段可阅读的讲解",
          objectives: ["学习目标"],
          questions: [{ id: "q1", prompt: "为什么？" }],
        }}
        locale="zh-CN"
      />,
    );
    expect(screen.getByText("一段可阅读的讲解")).toBeTruthy();
    expect(screen.getByText("为什么？")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("loads real lessons and keeps an empty course honest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ lessons: [], classes: [] })),
    );
    render(<TeachingLessonsWorkspace courseId="course-1" locale="zh-CN" />);
    expect(
      await screen.findByText("尚无课时。导入材料包或从已保存的教学草稿开始。"),
    ).toBeTruthy();
    expect(screen.getByLabelText("选择课时 JSON 文件")).toHaveProperty(
      "multiple",
      true,
    );
  });
  it("keeps teacher draft text on a failed save", async () => {
    const lesson = {
      lessonKey: "lesson-1",
      title: "课时",
      position: 1,
      status: "draft",
      draftRevision: 1,
      latestVersion: 0,
      updatedAt: "2026-10-26T00:00:00Z",
      package: {
        schemaVersion: 1,
        primaryLocale: "zh-CN",
        studentContent: {
          title: "课时",
          objectives: [],
          body: "原正文",
          questions: [],
        },
        teacherGuide: { notes: "私有", answers: [] },
        tasks: [],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "PATCH"
          ? Response.json(
              { reasonCode: "lesson-draft-revision-conflict" },
              { status: 409 },
            )
          : url.endsWith("/lesson-1")
            ? Response.json({ lesson })
            : Response.json({
                lessons: [lesson],
                classes: [{ externalId: "class-1", name: "一班" }],
              }),
      ),
    );
    render(<TeachingLessonsWorkspace courseId="course-1" locale="zh-CN" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑课时" }));
    const body = await screen.findByRole("textbox", { name: "学生讲解正文" });
    fireEvent.change(body, { target: { value: "保留未保存正文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("另一个"),
    );
    expect(body).toHaveProperty("value", "保留未保存正文");
  });
});
