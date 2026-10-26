import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningPracticePanel } from "@/components/pages/learning-practice-panel";

vi.mock("@/components/providers/session-user", () => ({
  useSessionUser: () => ({
    account: "review-student",
    role: "student",
    displayName: "Review Student",
    department: "Test",
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("independent classroom review regressions", () => {
  it("lets an image-only submission at its three-image limit begin revision by removing an old image", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const oldVersion = "11111111-1111-4111-8111-111111111111";
    const newVersion = "22222222-2222-4222-8222-222222222222";
    const images = Array.from({ length: 3 }, (_, index) => ({
      id: `old-image-${index}`,
      submissionVersionId: oldVersion,
      clientAttachmentId: `client-${index}`,
      position: index + 1,
      mime: "image/png",
      byteLength: 30,
      width: 10,
      height: 10,
      sha256: "a".repeat(64),
      url: `/api/learning/submission-images/old-image-${index}`,
    }));
    const unit = {
      unit: {
        courseId: "course-review",
        classId: "class-review",
        lessonKey: "lesson-review",
      },
      activity: {
        id: "activity-review",
        status: "published",
        title: { "zh-CN": "图片修订任务", "en-US": "Image revision" },
        instructions: { "zh-CN": "改进你的图片", "en-US": "Revise your image" },
        rubric: [],
      },
      formative: { attempted: true, attemptCount: 1 },
      submission: {
        id: "submission-review",
        state: "revision_requested",
        currentVersion: {
          id: oldVersion,
          status: "sealed",
          contentText: "",
          draftRevision: 4,
          attachments: images,
        },
      },
      feedback: [],
      completion: { completed: false },
    };
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({
          method,
          url: String(input),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (method === "PUT") {
          unit.submission.state = "draft";
          unit.submission.currentVersion = {
            id: newVersion,
            status: "draft",
            contentText: "",
            draftRevision: 1,
            attachments: images.map((image, index) => ({
              ...image,
              id: `new-image-${index}`,
              submissionVersionId: newVersion,
            })),
          };
          return Response.json({
            status: "persisted",
            revision: 1,
            submissionVersionId: newVersion,
          });
        }
        if (method === "DELETE")
          return Response.json({ status: "removed", revision: 2 });
        return Response.json(unit);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      createElement(LearningPracticePanel, {
        locale: "zh-CN",
        courseId: "course-review",
        classId: "class-review",
        lessonKey: "lesson-review",
        signInHref: "/login",
      }),
    );
    await screen.findByRole("heading", { name: "图片修订任务" });
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "移除图片" })[0],
      ).toHaveProperty("disabled", false),
    );
    expect(screen.getByLabelText("上传作业图片")).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "移除图片" })[0]);
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === "PUT"),
        "removing evidence from a revision request must first create its editable version",
      ).toBe(true),
    );
    const deletion = calls.find((call) => call.method === "DELETE");
    expect(JSON.parse(deletion!.body!)).toEqual({
      expectedSubmissionVersionId: newVersion,
      expectedDraftRevision: 1,
    });
    expect(
      calls.some(
        (call) => call.method === "DELETE" && call.url.includes("old-image"),
      ),
    ).toBe(false);
    await waitFor(() =>
      expect(screen.getByLabelText("上传作业图片")).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(screen.getAllByRole("img")).toHaveLength(2);
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "DELETE" && call.url.endsWith("new-image-0"),
        ),
        "the removal must target the copied image, never the sealed previous version",
      ).toBe(true),
    );
  });
});
