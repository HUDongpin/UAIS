import { act, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningPracticePanel } from "@/components/pages/learning-practice-panel";
import { SessionUserProvider } from "@/components/providers/session-user";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const storageKey = "uais:p1:draft-recovery:v2:student-a:course-1:class-1:activity-1";
function unitResponse(state = "draft", contentText = "Server text", draftRevision = 1) {
  return {
    activity: {
      id: "activity-1", status: "published",
      title: { "zh-CN": "任务", "en-US": "Task" },
      instructions: { "zh-CN": "写", "en-US": "Write" }, rubric: [],
    },
    formative: { attempted: true },
    submission: {
      id: "submission-1", state,
      currentVersion: { id: "version-1", status: state === "draft" ? "draft" : "sealed", contentText, draftRevision },
    },
  };
}

function panel(account = "student-a", locale: "en-US" | "zh-CN" = "en-US") {
  return <SessionUserProvider initialSessionUser={{ account, role: "student", displayName: "Student", department: "Test" }}>
    <LearningPracticePanel locale={locale} courseId="course-1" classId="class-1" lessonKey="lesson-1" signInHref="/login" />
  </SessionUserProvider>;
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

async function loadEditors() {
  const tabA = render(panel());
  const tabB = render(panel());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return {
    tabA, tabB,
    editorA: within(tabA.container).getByRole("textbox", { name: "Learning evidence text" }),
    editorB: within(tabB.container).getByRole("textbox", { name: "Learning evidence text" }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Learning practice recovery cleanup", () => {
  it("preserves another tab's newer recovery when an earlier autosave completes", async () => {
    const save = deferredResponse();
    let remote = unitResponse();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method ? save.promise : Response.json(remote)));
    vi.useFakeTimers();
    const { tabA, tabB, editorA, editorB } = await loadEditors();
    fireEvent.change(editorA, { target: { value: "Tab A older save" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    fireEvent.change(editorB, { target: { value: "Tab B newer offline work" } });
    const newerRecovery = window.localStorage.getItem(storageKey);
    expect(JSON.parse(newerRecovery!).contentText).toBe("Tab B newer offline work");
    remote = unitResponse("draft", "Tab A older save", 2);
    await act(async () => { save.resolve(Response.json({ revision: 2, submissionVersionId: "version-1" })); });
    expect(window.localStorage.getItem(storageKey)).toBe(newerRecovery);
    tabA.unmount();
    tabB.unmount();
    const reloaded = render(panel());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(within(reloaded.container).getByRole("textbox", { name: "Learning evidence text" })).toHaveProperty("value", "Tab B newer offline work");
    expect(within(reloaded.container).getByRole("button", { name: "Explicitly merge both" })).toBeTruthy();
  });

  it("preserves another tab's recovery when an earlier submit completes", async () => {
    const submit = deferredResponse();
    let remote = unitResponse();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method ? submit.promise : Response.json(remote)));
    vi.useFakeTimers();
    const { tabA, editorB } = await loadEditors();
    fireEvent.click(within(tabA.container).getByRole("button", { name: "Seal and submit" }));
    fireEvent.change(editorB, { target: { value: "Tab B pending work" } });
    const newerRecovery = window.localStorage.getItem(storageKey);
    expect(JSON.parse(newerRecovery!).contentText).toBe("Tab B pending work");
    remote = unitResponse("submitted");
    await act(async () => { submit.resolve(Response.json({ status: "submitted" })); });
    expect(window.localStorage.getItem(storageKey)).toBe(newerRecovery);
  });

  it("clears its own saved recovery while preserving other learner and activity keys", async () => {
    const save = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method ? save.promise : Response.json(unitResponse())));
    vi.useFakeTimers();
    const rendered = render(panel());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(within(rendered.container).getByRole("textbox", { name: "Learning evidence text" }), { target: { value: "This editor's text" } });
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    const otherAccountKey = storageKey.replace("student-a", "student-b");
    const otherActivityKey = storageKey.replace("activity-1", "activity-2");
    window.localStorage.setItem(otherAccountKey, "other learner recovery");
    window.localStorage.setItem(otherActivityKey, "other activity recovery");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await act(async () => { save.resolve(Response.json({ revision: 2, submissionVersionId: "version-1" })); });
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(window.localStorage.getItem(otherAccountKey)).toBe("other learner recovery");
    expect(window.localStorage.getItem(otherActivityKey)).toBe("other activity recovery");
  });

  it("clears an unchanged recovered copy already present on the server", async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 3,
      scope: { learnerAccount: "student-a", courseId: "course-1", classId: "class-1", activityId: "activity-1" },
      contentText: "Server text", updatedAt: Date.now(),
      base: { submissionVersionId: "version-1", draftRevision: 1 },
    }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(unitResponse())));
    vi.useFakeTimers();
    render(panel());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("retains the previous activity's recovery when a legacy reload selects a new default activity", async () => {
    let remote = unitResponse();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") remote = { ...remote, submission: { ...remote.submission, state: "submitted" } };
      return Response.json(remote);
    }));
    vi.useFakeTimers();
    const rendered = render(panel());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(within(rendered.container).getByRole("textbox", { name: "Learning evidence text" }), { target: { value: "Unsent earlier activity work" } });
    const earlierRecovery = window.localStorage.getItem(storageKey);
    expect(JSON.parse(earlierRecovery!).contentText).toBe("Unsent earlier activity work");
    remote = { ...unitResponse(), activity: { ...unitResponse().activity, id: "activity-2" } };
    rendered.rerender(panel("student-a", "zh-CN"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(window.localStorage.getItem(storageKey)).toBe(earlierRecovery);
    fireEvent.click(within(rendered.container).getByRole("button", { name: "封存并提交" }));
    await act(async () => {});
    expect(window.localStorage.getItem(storageKey)).toBe(earlierRecovery);
  });
});
