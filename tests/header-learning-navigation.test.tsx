import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import LearningRoute from "@/app/learning/page";
import { LearningPracticePanel } from "@/components/pages/learning-practice-panel";
import { SessionUserProvider } from "@/components/providers/session-user";
import { createLearningReturnPath } from "@/lib/auth/login-return-path";

const playbackState = vi.hoisted(() => ({ error: "not-published" }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({ locale: "zh-CN", theme: "light" }),
}));
vi.mock("@/components/pages/learning-page-published-playback", () => ({
  usePublishedLearningPlayback: () => ({
    publishedPlayback: undefined,
    publishedPlaybackError: playbackState.error,
    isPublishedPlaybackLoading: false,
    activePublishedSlide: undefined,
    activePublishedSlideIndex: 0,
    setActivePublishedSlideIndex: vi.fn(),
    retryPublishedPlayback: vi.fn(),
  }),
}));

const activityId = "11111111-1111-4111-8111-111111111111";
const otherActivityId = "22222222-2222-4222-8222-222222222222";
const user = { account: "student-header", role: "student", displayName: "Student", department: "QA" } as const;
const target = { courseId: "course-header", classId: "class-b", lessonKey: "lesson-b", activityId };
const returnPath = `/learning?courseId=course-header&classId=class-b&lessonKey=lesson-b&activityId=${activityId}`;

function unit(id = activityId, title = "选中的学习任务") {
  return {
    unit: { courseId: target.courseId, classId: target.classId, lessonKey: target.lessonKey },
    activity: {
      id, status: "published",
      title: { "zh-CN": title, "en-US": "Selected activity" },
      instructions: { "zh-CN": "完成此任务。", "en-US": "Complete this task." },
      rubric: [],
    },
    formative: { attempted: false },
    feedback: [],
  };
}

function panel(id = activityId) {
  return (
    <SessionUserProvider initialSessionUser={user}>
      <LearningPracticePanel
        locale="zh-CN" courseId={target.courseId} classId={target.classId}
        lessonKey={target.lessonKey} requestedActivityId={id} signInHref="/login"
      />
    </SessionUserProvider>
  );
}

afterEach(() => {
  playbackState.error = "not-published";
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it("preserves the selected class, lesson and activity in sign-in return paths", () => {
  expect(createLearningReturnPath(target)).toBe(returnPath);
  expect(createLearningReturnPath({ courseId: "course-header", classId: "class-b" }))
    .toBe("/learning?courseId=course-header&classId=class-b");
});

it("opens the calendar's selected task even when its course has no playback manifest", async () => {
  const fetcher = vi.fn(async (path: string) => {
    if (path === "/api/teaching/courses") return Response.json({
      courses: [{ courseId: target.courseId, courseName: "Header course" }],
      classes: [{ courseId: target.courseId, classId: target.classId, className: "Class B" }],
      memberships: [{ courseId: target.courseId, classId: target.classId, membershipStatus: "approved" }],
    });
    return Response.json(unit());
  });
  vi.stubGlobal("fetch", fetcher);
  const route = await LearningRoute({ searchParams: Promise.resolve(target) });
  render(<SessionUserProvider initialSessionUser={user}>{route}</SessionUserProvider>);
  expect(await screen.findByRole("heading", { name: "选中的学习任务" })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith(
    `/api/learning/courses/course-header/units/lesson-b?activityId=${activityId}&classId=class-b`,
    expect.objectContaining({ cache: "no-store" }),
  );
});

it("requests and displays only the explicitly selected activity and class", async () => {
  const fetcher = vi.fn(async () => Response.json(unit()));
  vi.stubGlobal("fetch", fetcher);
  render(panel());
  expect(await screen.findByRole("heading", { name: "选中的学习任务" })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith(
    `/api/learning/courses/course-header/units/lesson-b?activityId=${activityId}&classId=class-b`,
    expect.objectContaining({ cache: "no-store" }),
  );
});

it("keeps the AI playback refusal while opening an independently authorized calendar task", async () => {
  playbackState.error = "access-denied";
  vi.stubGlobal("fetch", vi.fn(async (path: string) => Response.json(
    path === "/api/teaching/courses" ? {
      courses: [{ courseId: target.courseId, courseName: "Header course" }],
      classes: [{ courseId: target.courseId, classId: target.classId, className: "Class B" }],
      memberships: [{ courseId: target.courseId, classId: target.classId, membershipStatus: "approved" }],
    } : unit(),
  )));
  const route = await LearningRoute({ searchParams: Promise.resolve(target) });
  const view = render(<SessionUserProvider initialSessionUser={user}>{route}</SessionUserProvider>);
  expect(await screen.findByRole("heading", { name: "选中的学习任务" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "智能导学", exact: true }));
  expect(view.container.querySelector('[data-uais-learning-companion-access="access-denied"]')).not.toBeNull();
  expect(screen.queryByPlaceholderText("向智能助教提问...")).toBeNull();
});

it.each([
  { activity: { ...unit().activity, id: otherActivityId } },
  { unit: { ...unit().unit, classId: "foreign-class" } },
  { unit: { ...unit().unit, lessonKey: "other-lesson" } },
])("refuses a successful response for a different task scope: %j", async (patch) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...unit(), ...patch })));
  render(panel());
  expect(await screen.findByText("暂时无法读取真实学习任务，请稍后重试。")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "选中的学习任务" })).toBeNull();
});

it("does not render an earlier activity's late response after selecting another notification", async () => {
  let finishOld!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOld = resolve; }))
    .mockImplementation(() => Promise.resolve(Response.json(unit(otherActivityId, "新的学习任务"))));
  vi.stubGlobal("fetch", fetcher);
  const view = render(panel());
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  view.rerender(panel(otherActivityId));
  expect(await screen.findByRole("heading", { name: "新的学习任务" })).toBeTruthy();
  await act(async () => { finishOld(Response.json(unit())); });
  expect(screen.queryByRole("heading", { name: "选中的学习任务" })).toBeNull();
  expect(screen.getByRole("heading", { name: "新的学习任务" })).toBeTruthy();
});
