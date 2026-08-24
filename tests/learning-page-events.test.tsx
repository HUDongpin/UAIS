import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";

const mockPreferences = vi.hoisted(() => ({ locale: "zh-CN" as "zh-CN" | "en-US" }));

vi.mock("@/components/providers/app-preferences", () => ({
  useAppPreferences: () => ({
    locale: mockPreferences.locale,
    theme: "light",
    setLocale: vi.fn(),
    toggleLocale: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img"> & { priority?: boolean; unoptimized?: boolean }) => {
    const rest = { ...props };
    delete rest.priority;
    delete rest.unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={rest.alt} {...rest} />;
  },
}));

import { LearningChatroomPage, LearningPage } from "@/components/pages/learning-page";
import { SessionUserProvider } from "@/components/providers/session-user";
import { resetReportedLearningEventsForTesting } from "@/lib/learning-records/client-event-reporter";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";

const studentUser: UaisAppSessionUser = {
  account: "student-001",
  role: "student",
  displayName: "Student One",
  department: "UAIS",
};

const teacherUser: UaisAppSessionUser = {
  account: "teacher-kang",
  role: "teacher",
  displayName: "Prof. Kang",
  department: "UAIS",
};

const publishedPlaybackManifest = {
  status: "ready",
  courseId: "elementary-math-research",
  courseTitle: "小学数学研究",
  sourceDeckTitle: "Deck",
  audioManifestId: "manifest-1",
  teacherName: "康夏",
  voiceLabel: "voice",
  slideCount: 1,
  slides: [
    {
      slideId: "slide-1",
      slideNumber: 1,
      slideTitle: "第一节",
      narrationText: "讲解文本",
      imageUrl: "/learning/slide-1.png",
      audioId: "audio-1",
      audioUrl: "/learning/audio-1.mp3",
      durationSeconds: 30,
    },
  ],
  redaction: {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "published-learning-ids-only",
  },
};

// Student-visible projections shaped like GET /api/teaching/courses returns for
// a signed-in student: an approved membership joined to the course/class rows.
// The chatroom resolves exactly one usable course from this, so it never falls
// back to the demo course and the composer becomes usable.
const studentChatroomCourse = {
  courseId: "uais-research-methods",
  courseName: "研究方法与论文写作",
  semester: "2026 春季",
};

const studentChatroomClass = {
  classId: "uais-research-methods-a",
  courseId: studentChatroomCourse.courseId,
  className: "研究方法 A 班",
  semester: studentChatroomCourse.semester,
};

const approvedStudentCourses = {
  courses: [studentChatroomCourse],
  classes: [studentChatroomClass],
  memberships: [
    {
      membershipId: "membership-001",
      courseId: studentChatroomCourse.courseId,
      classId: studentChatroomClass.classId,
      membershipStatus: "approved",
      joinedAt: "2026-02-01T00:00:00.000Z",
      approvedAt: "2026-02-02T00:00:00.000Z",
    },
  ],
};

const noUsableCourses = { courses: [], classes: [], memberships: [] };

type FetchCall = { url: string; body: Record<string, unknown> };

function stubFetch(options: {
  playback: "ready" | "pending";
  // Body served by GET /api/teaching/courses; defaults to an empty roster so
  // the authenticated chatroom settles on its fail-closed no-course state.
  teachingCourses?: unknown;
}) {
  const learningEventCalls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/learning-records/events")) {
      learningEventCalls.push({
        url,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json({ status: "queued" }, { status: 202 });
    }
    if (url.includes("/api/teaching/courses")) {
      return Response.json(options.teachingCourses ?? noUsableCourses);
    }
    if (url.includes("/api/learning/ppt-playback/")) {
      if (options.playback === "ready") {
        return Response.json({ playback: publishedPlaybackManifest });
      }
      return new Promise<Response>(() => {});
    }
    if (url.includes("/api/learning/ai-guide")) {
      return Response.json({ message: { text: "好的，我来解释。" } });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, learningEventCalls };
}

describe("learning page learning-record emission", () => {
  afterEach(() => {
    mockPreferences.locale = "zh-CN";
    resetReportedLearningEventsForTesting();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits collaboration.contributed when a signed-in student sends a chatroom message", async () => {
    const { learningEventCalls } = stubFetch({
      playback: "pending",
      teachingCourses: approvedStudentCourses,
    });
    const { container } = render(
      <SessionUserProvider initialSessionUser={studentUser}>
        <LearningChatroomPage />
      </SessionUserProvider>,
    );

    // The room has no active course (and a disabled composer) until the course
    // fetch settles, so wait for the resolved course to be announced first.
    await screen.findByText(/研究方法与论文写作/);
    const input = container.querySelector<HTMLInputElement>("#group-message");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(input as HTMLInputElement, { target: { value: "大家好，@研究助教 请看这个问题" } });
    fireEvent.submit((input as HTMLInputElement).closest("form") as HTMLFormElement);

    await waitFor(() => expect(learningEventCalls).toHaveLength(1));
    // The record is scoped to the resolved real course, and the cohort is the
    // membership's class rather than the static demo group id.
    expect(learningEventCalls[0].body).toEqual(
      expect.objectContaining({
        actorId: "student-001",
        event: expect.objectContaining({
          type: "collaboration.contributed",
          object: expect.objectContaining({
            id: "uais-research-methods/chatrooms/uais-research-methods-a",
          }),
          context: expect.objectContaining({
            courseId: "uais-research-methods",
            classId: "uais-research-methods-a",
            cohortId: "uais-research-methods-a",
          }),
        }),
      }),
    );
    expect(String(learningEventCalls[0].body.idempotencyKey)).toContain(
      "student-001:collaboration.contributed:uais-research-methods:uais-research-methods-a:",
    );
  });

  it("does not emit learning records for non-student sessions", async () => {
    const { learningEventCalls } = stubFetch({
      playback: "pending",
      teachingCourses: { courses: [studentChatroomCourse] },
    });
    const { container } = render(
      <SessionUserProvider initialSessionUser={teacherUser}>
        <LearningChatroomPage />
      </SessionUserProvider>,
    );

    // Exercise the real-course send path: the absence of a learning record must
    // come from the teacher role, not from the no-course composer being closed.
    await screen.findByText(/研究方法与论文写作/);
    const input = container.querySelector<HTMLInputElement>("#group-message");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(input as HTMLInputElement, { target: { value: "教师预览消息" } });
    fireEvent.submit((input as HTMLInputElement).closest("form") as HTMLFormElement);

    await screen.findByText("教师预览消息");
    expect(learningEventCalls).toHaveLength(0);
  });

  it("emits ai.feedback.requested with a unique key when a published deck attributes the course", async () => {
    const { learningEventCalls } = stubFetch({ playback: "ready" });
    render(
      <SessionUserProvider initialSessionUser={studentUser}>
        <LearningPage />
      </SessionUserProvider>,
    );

    // Wait for the deck: without it there is no course this student is known to
    // be in, and the guide question is deliberately not recorded (below).
    await screen.findAllByText("第一节");
    const guideInput = screen.getByLabelText("向智能助教提问");
    fireEvent.change(guideInput, { target: { value: "什么是梯度下降？" } });
    fireEvent.submit(guideInput.closest("form") as HTMLFormElement);

    await waitFor(() => expect(learningEventCalls).toHaveLength(1));
    expect(learningEventCalls[0].body).toEqual(
      expect.objectContaining({
        actorId: "student-001",
        event: expect.objectContaining({
          type: "ai.feedback.requested",
          object: expect.objectContaining({
            id: expect.stringContaining("elementary-math-research/ai-guide/"),
          }),
          context: expect.objectContaining({
            courseId: "elementary-math-research",
          }),
        }),
      }),
    );
    expect(String(learningEventCalls[0].body.idempotencyKey)).toContain(
      ":ai.feedback.requested:",
    );
  });

  // A bare /learning with no published deck falls back to the TEMPLATE's demo
  // course (`research-methods-learning`), which a real student has never joined.
  // Stamping their guide questions, notes exports and checkpoint attempts with
  // that id wrote a course they are not in into their own learning record - and
  // the events route refuses them anyway
  // (`learner-course-membership-required`), so the calls were pure noise.
  it("emits no learning record on a bare /learning the student is not enrolled in", async () => {
    const { learningEventCalls } = stubFetch({ playback: "pending" });
    render(
      <SessionUserProvider initialSessionUser={studentUser}>
        <LearningPage />
      </SessionUserProvider>,
    );

    const guideInput = screen.getByLabelText("向智能助教提问");
    fireEvent.change(guideInput, { target: { value: "什么是梯度下降？" } });
    fireEvent.submit(guideInput.closest("form") as HTMLFormElement);

    // The guide answer proves the interaction completed; the record did not.
    await screen.findByText("好的，我来解释。");
    expect(learningEventCalls).toHaveLength(0);
    expect(
      learningEventCalls.some((call) =>
        JSON.stringify(call.body).includes("research-methods-learning"),
      ),
    ).toBe(false);
  });

  it("emits narration progress and course.completed once every slide narration finishes", async () => {
    const { learningEventCalls } = stubFetch({ playback: "ready" });
    const { container } = render(
      <SessionUserProvider initialSessionUser={studentUser}>
        <LearningPage />
      </SessionUserProvider>,
    );

    await waitFor(() =>
      expect(
        container.querySelector('audio[data-uais-learning-ppt-audio="active-slide"]'),
      ).toBeTruthy(),
    );
    const audio = container.querySelector(
      'audio[data-uais-learning-ppt-audio="active-slide"]',
    ) as HTMLAudioElement;

    fireEvent.play(audio);
    await waitFor(() => expect(learningEventCalls).toHaveLength(1));

    fireEvent.ended(audio);
    await waitFor(() => expect(learningEventCalls).toHaveLength(3));

    const [started, completed, courseCompleted] = learningEventCalls.map((call) => call.body);
    expect(String(started.idempotencyKey)).toContain(":narration-started");
    expect(started.event).toEqual(
      expect.objectContaining({
        type: "activity.attempted",
        object: expect.objectContaining({
          id: "elementary-math-research/ppt-playback/manifest-1/slides/slide-1",
        }),
        context: expect.objectContaining({
          courseId: "elementary-math-research",
          lessonId: "manifest-1",
        }),
      }),
    );
    expect(String(completed.idempotencyKey)).toContain(":narration-completed");
    // Deliberately NO result.completion on a per-slide narration finish: only
    // the all-slides course.completed below may complete the lesson (412a52c).
    expect(completed.event).toEqual(
      expect.objectContaining({
        type: "activity.attempted",
        result: { duration: "PT30S" },
      }),
    );
    expect(courseCompleted.event).toEqual(
      expect.objectContaining({
        type: "course.completed",
        object: expect.objectContaining({ id: "elementary-math-research" }),
        result: expect.objectContaining({ completion: true }),
        context: expect.objectContaining({
          courseId: "elementary-math-research",
          lessonId: "manifest-1",
        }),
      }),
    );

    // Replaying the same slide must not duplicate the deduplicated records.
    fireEvent.play(audio);
    fireEvent.ended(audio);
    await waitFor(() => expect(learningEventCalls).toHaveLength(3));
  });
});
