// Frontend contract coverage for the live multi-agent chatroom endpoint
// (POST /api/learning/chatroom) as consumed by the learner chatroom UI:
// real-course resolution via GET /api/teaching/courses (URL hint, picker,
// course switching, demo fallback, load failure, malformed body), composer
// gating before a course resolves, prior-transcript restore via
// GET /api/learning/chatroom, seed-transcript rules, request shape, rendered
// agent turns, pending state, stale-round discard on course switch, the
// 4000-char draft guard, and localized failures.
// Runs in the shared jsdom environment configured in vitest.config.mts.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

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

import { LearningChatroomPage } from "@/components/pages/learning-page-chatroom";
import { SessionUserProvider } from "@/components/providers/session-user";
import { chatMessages } from "@/data/uais";
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

const demoCourseLabel = "示例课程：初等数学研究";
const courseALabel = "当前课程：课程A · A班 · 2026春";
const courseBLabel = "当前课程：课程B · B班 · 2026春";
const joinCoursePrompt =
  "暂无可用的真实课程，下方仅为示例回放。加入或创建一门课程后即可与智能体对话。";
const courseLoadFailedCopy = "暂时无法加载你的课程列表，请稍后再试。";
const accessDeniedCopy =
  "你还没有这门课程的智能体使用权限，请先加入或创建这门课程后再试。";
const emptyChatCopy = "暂无聊天内容。发送第一条小组消息即可开始协作。";
const seedMessageIds = new Set(chatMessages.map((message) => message.id));

type FetchCall = {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
};

type ChatroomRequestBody = {
  locale: string;
  courseId: string;
  classId?: string;
  messages: Array<{ id: string; role: string; content: string; agentId?: string }>;
};

type StoredTranscriptMessage = {
  id: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
};

function storedTranscriptResponse(messages: StoredTranscriptMessage[]) {
  return Response.json({
    messages: messages.map((message) => ({
      createdAt: "2026-08-01T02:30:00.000Z",
      ...message,
    })),
    transcript: { status: "loaded", messageCount: messages.length },
  });
}

type StubOptions = {
  chatroom?: () => Promise<Response> | Response;
  // GET /api/learning/chatroom: the room's stored transcript. Shares the round
  // endpoint's path, so the stub routes the two apart by method; the requested
  // url is passed through so a test can answer per room.
  chatroomHistory?: (url: string) => Promise<Response> | Response;
  teachingCourses?: () => Promise<Response> | Response;
};

function stubFetch(options: StubOptions = {}) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url,
      method,
      body: init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined,
    });
    if (url.includes("/api/learning-records/events")) {
      return Response.json({ status: "queued" }, { status: 202 });
    }
    if (url.includes("/api/teaching/courses")) {
      // Default: a well-formed empty student roster, which resolves the demo
      // course through the genuine "no usable courses" path.
      return options.teachingCourses
        ? options.teachingCourses()
        : Response.json({ courses: [], classes: [], memberships: [] });
    }
    if (url.includes("/api/learning/chatroom")) {
      if (method === "GET") {
        // Default: a room with no stored history, so the transcript restore is
        // a no-op unless a test opts into it.
        return options.chatroomHistory
          ? options.chatroomHistory(url)
          : Response.json({
              messages: [],
              transcript: { status: "loaded", messageCount: 0 },
            });
      }
      return options.chatroom
        ? options.chatroom()
        : Response.json({ status: "end", turns: [], progress: [], orchestration: {} });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

// Rounds only: the transcript restore shares the endpoint path and is asserted
// through `chatroomHistoryCalls`.
function chatroomCalls(calls: FetchCall[]) {
  return calls.filter(
    (call) => call.url.includes("/api/learning/chatroom") && call.method === "POST",
  );
}

function chatroomHistoryCalls(calls: FetchCall[]) {
  return calls.filter(
    (call) => call.url.includes("/api/learning/chatroom") && call.method === "GET",
  );
}

type StudentCourseFixture = {
  courseId: string;
  courseName: string;
  classId: string;
  className: string;
  semester: string;
};

const courseA: StudentCourseFixture = {
  courseId: "course-a",
  courseName: "课程A",
  classId: "class-a",
  className: "A班",
  semester: "2026春",
};

const courseB: StudentCourseFixture = {
  courseId: "course-b",
  courseName: "课程B",
  classId: "class-b",
  className: "B班",
  semester: "2026春",
};

function studentCoursesResponse(fixtures: StudentCourseFixture[]) {
  return Response.json({
    courses: fixtures.map((fixture) => ({
      courseId: fixture.courseId,
      courseName: fixture.courseName,
      semester: fixture.semester,
    })),
    classes: fixtures.map((fixture) => ({
      classId: fixture.classId,
      courseId: fixture.courseId,
      className: fixture.className,
      semester: fixture.semester,
    })),
    memberships: fixtures.map((fixture, index) => ({
      membershipId: `membership-${index + 1}`,
      courseId: fixture.courseId,
      classId: fixture.classId,
      membershipStatus: "approved",
      joinedAt: "2026-08-01T00:00:00.000Z",
    })),
  });
}

// Owned-course records carry no class projection, so a teacher option never
// has a classId.
function teacherCoursesResponse(fixtures: StudentCourseFixture[]) {
  return Response.json({
    courses: fixtures.map((fixture) => ({
      courseId: fixture.courseId,
      courseName: fixture.courseName,
      semester: fixture.semester,
    })),
  });
}

function composerInput(container: HTMLElement) {
  const input = container.querySelector<HTMLTextAreaElement>("#group-message");
  expect(input).toBeTruthy();
  return input as HTMLTextAreaElement;
}

function sendMessage(container: HTMLElement, value: string) {
  const input = composerInput(container);
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

function renderSignedInChatroom(user: UaisAppSessionUser = studentUser) {
  return render(
    <SessionUserProvider initialSessionUser={user}>
      <LearningChatroomPage />
    </SessionUserProvider>,
  );
}

async function waitForDemoCourse() {
  await screen.findByText(demoCourseLabel);
}

// The everyday learner path: one approved course auto-resolves, so the
// composer is live against a real courseId.
function stubSingleCourseStudent(chatroom?: StubOptions["chatroom"]) {
  return stubFetch({
    teachingCourses: () => studentCoursesResponse([courseA]),
    chatroom,
  });
}

async function waitForCourseA() {
  await screen.findByText(courseALabel);
}

// Lets an already-resolved in-flight round finish its await chain (fetch →
// Response.json → state writes) so the assertions below observe its full
// effect — or, for a discarded round, prove there was none.
async function settleInFlightRound() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Mention runs render as chips (their own elements), so a bubble carrying an
// @handle is text broken across nodes and no single text node holds the whole
// message. These read the bubble's own textContent instead.
function bubbleTexts() {
  return Array.from(document.querySelectorAll("article")).map(
    (article) => article.textContent ?? "",
  );
}

function expectBubbleWithText(text: string) {
  expect(bubbleTexts().some((bubble) => bubble.includes(text))).toBe(true);
}

function expectNoBubbleWithText(text: string) {
  expect(bubbleTexts().some((bubble) => bubble.includes(text))).toBe(false);
}

function expectNoSeedMessages(body: ChatroomRequestBody) {
  expect(
    body.messages.some((message) => seedMessageIds.has(message.id)),
  ).toBe(false);
}

describe("learner chatroom live multi-agent endpoint", () => {
  afterEach(() => {
    mockPreferences.locale = "zh-CN";
    resetReportedLearningEventsForTesting();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves a single approved course, hides seeds, and renders the returned agent turn", async () => {
    const { calls } = stubSingleCourseStudent(() =>
      Response.json({
        status: "cue-user",
        turns: [
          {
            agentId: "methods-consultant",
            content: "先把自变量、因变量和控制变量分开定义。",
            provider: { provider: "deepseek", role: "methods", model: "deepseek-chat" },
          },
        ],
        progress: [],
        orchestration: {},
      }),
    );

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    // A real course starts from the empty-chat placeholder, never from seeds.
    expect(screen.queryByText("方法顾问")).toBeNull();

    sendMessage(container, "@方法顾问 变量怎么定？");
    await screen.findByText("先把自变量、因变量和控制变量分开定义。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(1);
    const body = posts[0].body as unknown as ChatroomRequestBody;
    expect(body.locale).toBe("zh-CN");
    expect(body.courseId).toBe("course-a");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual(
      expect.objectContaining({
        role: "student",
        content: "@方法顾问 变量怎么定？",
      }),
    );
    expectNoSeedMessages(body);
    expect(screen.getAllByText("方法顾问")).toHaveLength(1);
  });

  it("keeps demo seeds display-only and lets a teacher chat in the demo fallback", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => Response.json({ courses: [] }),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [{ agentId: "methods-consultant", content: "示例课程的回复。" }],
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderSignedInChatroom(teacherUser);
    await waitForDemoCourse();
    await screen.findByText(joinCoursePrompt);
    // Demo context renders the seed transcript (one seeded 方法顾问 author).
    expect(screen.getAllByText("方法顾问")).toHaveLength(1);
    // The demo carve-out authorizes demo teacher accounts, so the composer
    // stays live for a teacher even without an owned course.
    expect(composerInput(container).disabled).toBe(false);

    sendMessage(container, "@方法顾问 变量怎么定？");
    await screen.findByText("示例课程的回复。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(1);
    const body = posts[0].body as unknown as ChatroomRequestBody;
    expect(body.courseId).toBe("elementary-math-research");
    // Seeds never enter the live history: only the fresh student message posts.
    expect(body.messages).toHaveLength(1);
    expectNoSeedMessages(body);
    // Seeded 方法顾问 message plus the freshly rendered live turn.
    expect(screen.getAllByText("方法顾问")).toHaveLength(2);
  });

  it("keeps the demo fallback read-only for a student with no usable courses", async () => {
    const { calls } = stubFetch({
      teachingCourses: () =>
        Response.json({ courses: [], classes: [], memberships: [] }),
    });

    const { container } = renderSignedInChatroom();
    await waitForDemoCourse();
    await screen.findByText(joinCoursePrompt);
    // The demo transcript stays visible as a preview (seeded student author).
    expect(screen.getByText("林若晨")).toBeTruthy();

    const input = composerInput(container);
    expect(input.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: /发送/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    sendMessage(container, "学生想在示例课程里发消息");

    // A learner without an approved membership would only get 403, so the room
    // must not let the message leave at all.
    expect(chatroomCalls(calls)).toHaveLength(0);
    expectNoBubbleWithText("学生想在示例课程里发消息");
    expect(input.value).toBe("学生想在示例课程里发消息");
  });

  it("shows the load-failed copy, not the no-courses copy, when the course fetch answers 500", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => new Response("", { status: 500 }),
    });

    const { container } = renderSignedInChatroom();
    await screen.findByText(courseLoadFailedCopy);
    expect(screen.queryByText(joinCoursePrompt)).toBeNull();

    const input = composerInput(container);
    expect(input.disabled).toBe(true);

    sendMessage(container, "课程加载失败时的消息");
    expect(chatroomCalls(calls)).toHaveLength(0);
  });

  it("shows the load-failed copy when the course fetch rejects", async () => {
    stubFetch({
      teachingCourses: () => Promise.reject(new Error("network down")),
    });

    renderSignedInChatroom();
    await screen.findByText(courseLoadFailedCopy);
    expect(screen.queryByText(joinCoursePrompt)).toBeNull();
  });

  it("disables the composer until course resolution settles", async () => {
    let resolveCourses: ((response: Response) => void) | undefined;
    const deferred = new Promise<Response>((resolve) => {
      resolveCourses = resolve;
    });
    const { calls } = stubFetch({ teachingCourses: () => deferred });

    const { container } = renderSignedInChatroom();
    const input = composerInput(container);
    expect(input.disabled).toBe(true);

    // A submit before resolution must never post a pre-resolution courseId.
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(chatroomCalls(calls)).toHaveLength(0);

    resolveCourses?.(studentCoursesResponse([courseA]));
    await waitForCourseA();
    expect(input.disabled).toBe(false);
  });

  it("sends with Enter while Shift+Enter preserves a multiline draft", async () => {
    const { calls } = stubSingleCourseStudent();
    const { container } = renderSignedInChatroom();
    await waitForCourseA();

    const input = composerInput(container);
    expect(input.tagName).toBe("TEXTAREA");

    fireEvent.change(input, { target: { value: "第一行" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });
    expect(chatroomCalls(calls)).toHaveLength(0);

    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(chatroomCalls(calls)).toHaveLength(1));
    const body = chatroomCalls(calls)[0].body as unknown as ChatroomRequestBody;
    expect(body.messages.at(-1)?.content).toBe("第一行\n第二行");
    expect(input.value).toBe("");
  });

  it("renders multiple turns in the order returned by the endpoint", async () => {
    stubSingleCourseStudent(() =>
      Response.json({
        status: "end",
        turns: [
          { agentId: "methods-consultant", content: "第一条智能体回复。" },
          { agentId: "writing-helper", content: "第二条智能体回复。" },
        ],
        progress: [],
        orchestration: {},
      }),
    );

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    sendMessage(container, "@方法顾问 @写作助手 一起看看这个提纲");

    await screen.findByText("第二条智能体回复。");

    const bubbles = Array.from(container.querySelectorAll("article")).map(
      (article) => article.textContent ?? "",
    );
    const firstIndex = bubbles.findIndex((text) => text.includes("第一条智能体回复。"));
    const secondIndex = bubbles.findIndex((text) => text.includes("第二条智能体回复。"));
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(bubbles[firstIndex]).toContain("方法顾问");
    expect(bubbles[secondIndex]).toContain("写作助手");
  });

  it("disables the send button and shows the thinking indicator while awaiting turns", async () => {
    let resolveTurn: ((response: Response) => void) | undefined;
    const deferred = new Promise<Response>((resolve) => {
      resolveTurn = resolve;
    });
    stubSingleCourseStudent(() => deferred);

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    const sendButton = screen.getByRole("button", { name: /发送/ }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);

    sendMessage(container, "@数学助教 帮我看看这道题");

    await waitFor(() => expect(sendButton.disabled).toBe(true));
    expect(screen.getByText("智能体思考中…")).toBeTruthy();

    resolveTurn?.(Response.json({ status: "end", turns: [], progress: [], orchestration: {} }));

    await waitFor(() => expect(sendButton.disabled).toBe(false));
    expect(screen.queryByText("智能体思考中…")).toBeNull();
  });

  it("keeps the student message and shows the unavailable copy when the request throws", async () => {
    stubSingleCourseStudent(() => Promise.reject(new Error("network down")));

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    sendMessage(container, "@研究助教 帮我梳理研究问题");

    await screen.findByText("智能服务暂时不可用，请稍后再试。");
    expectBubbleWithText("@研究助教 帮我梳理研究问题");
    // An outage is the one refusal the student can do nothing about, so it has to
    // name someone reachable. The sentence comes from the single `copy.ts` slot
    // (`auth.supportChannel`) the owner will swap for the real channel.
    expect(document.querySelector("[data-uais-support-channel]")?.textContent).toBe(
      "如果问题持续出现，请联系任课教师获取帮助。",
    );
  });

  it("shows the sign-in copy when the endpoint answers 401", async () => {
    stubSingleCourseStudent(() =>
      Response.json({ error: "not signed in" }, { status: 401 }),
    );

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    sendMessage(container, "@研究助教 会话过期了吗？");

    await screen.findByText("请先登录，再与智能体对话。");
    expectBubbleWithText("@研究助教 会话过期了吗？");
  });

  it("shows the actionable course-access copy when the endpoint answers 403", async () => {
    stubSingleCourseStudent(() =>
      Response.json({ error: "no course access" }, { status: 403 }),
    );

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    sendMessage(container, "@方法顾问 我能用这门课的智能体吗？");

    await screen.findByText(accessDeniedCopy);
  });

  it("shows the request-invalid copy when the endpoint answers 400", async () => {
    stubSingleCourseStudent(() =>
      Response.json({ error: "message too long" }, { status: 400 }),
    );

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    sendMessage(container, "@方法顾问 这条消息被服务端拒绝了吗？");

    await screen.findByText("消息未通过检查，请调整内容后重试。");
  });

  it("blocks an over-limit draft with the too-long copy before any chatroom call", async () => {
    const { calls } = stubSingleCourseStudent();

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    const longDraft = "长".repeat(4001);
    sendMessage(container, longDraft);

    await screen.findByText("单条消息不能超过 4000 字，请精简后再发送。");
    expect(chatroomCalls(calls)).toHaveLength(0);
    // The draft stays editable instead of being appended to the transcript.
    expect(composerInput(container).value).toHaveLength(4001);
  });

  it("selects a URL-matched course, skips the picker and seeds, and posts that courseId", async () => {
    window.history.replaceState(
      {},
      "",
      "/learning/chatroom?courseId=course-a&classId=class-a",
    );
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [{ agentId: "research-assistant", content: "课程A的回复。" }],
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    expect(screen.queryByText("选择聊天室课程")).toBeNull();
    // Real-course context starts from the empty-chat placeholder, not seeds.
    expect(screen.queryByText("方法顾问")).toBeNull();
    expect(screen.getByText(emptyChatCopy)).toBeTruthy();

    sendMessage(container, "@研究助教 这门课的问题");
    await screen.findByText("课程A的回复。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(1);
    const body = posts[0].body as unknown as ChatroomRequestBody;
    expect(body.courseId).toBe("course-a");
    expect(body.messages).toHaveLength(1);
    expectNoSeedMessages(body);
  });

  it("keeps a class-scoped teacher deep link on the matching classId-free course", async () => {
    window.history.replaceState(
      {},
      "",
      "/learning/chatroom?courseId=course-a&classId=class-a",
    );
    stubFetch({ teachingCourses: () => teacherCoursesResponse([courseA, courseB]) });

    renderSignedInChatroom(teacherUser);
    await screen.findByText("当前课程：课程A · 2026春");
    expect(screen.queryByText("选择聊天室课程")).toBeNull();
  });

  it("renders the course picker for two approved courses and chats with the chosen one", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [{ agentId: "research-assistant", content: "课程B的回复。" }],
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderSignedInChatroom();
    await screen.findByText("选择聊天室课程");
    // No course picked yet: seeds hidden and the composer is disabled.
    expect(screen.queryByText("方法顾问")).toBeNull();
    const input = composerInput(container);
    expect(input.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /课程B/ }));
    await screen.findByText(courseBLabel);
    expect(screen.queryByText("选择聊天室课程")).toBeNull();
    expect(input.disabled).toBe(false);

    sendMessage(container, "@研究助教 B课程的问题");
    await screen.findByText("课程B的回复。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(1);
    const body = posts[0].body as unknown as ChatroomRequestBody;
    expect(body.courseId).toBe("course-b");
    expectNoSeedMessages(body);
  });

  it("resets the transcript but keeps the draft when the active course switches", async () => {
    let round = 0;
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB]),
      chatroom: () => {
        round += 1;
        return Response.json({
          status: "cue-user",
          turns: [{ agentId: "research-assistant", content: `第${round}轮回复。` }],
          progress: [],
          orchestration: {},
        });
      },
    });

    const { container } = renderSignedInChatroom();
    await screen.findByText("选择聊天室课程");
    fireEvent.click(screen.getByRole("button", { name: /课程A/ }));
    await waitForCourseA();

    sendMessage(container, "@研究助教 课程A的问题");
    await screen.findByText("第1轮回复。");

    // Type the next message, then reopen the picker from the course chip.
    const input = composerInput(container);
    fireEvent.change(input, { target: { value: "还没发送的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: /课程A · A班/ }));
    fireEvent.click(screen.getByRole("button", { name: /课程B/ }));
    await screen.findByText(courseBLabel);

    // The new room starts empty; only the typed draft survives the switch.
    expect(screen.queryByText("第1轮回复。")).toBeNull();
    expectNoBubbleWithText("@研究助教 课程A的问题");
    expect(screen.getByText(emptyChatCopy)).toBeTruthy();
    expect(input.value).toBe("还没发送的草稿");

    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await screen.findByText("第2轮回复。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(2);
    const secondBody = posts[1].body as unknown as ChatroomRequestBody;
    expect(secondBody.courseId).toBe("course-b");
    // No course-a history leaks into the course-b request.
    expect(secondBody.messages).toHaveLength(1);
    expect(secondBody.messages[0].content).toBe("还没发送的草稿");
  });

  it("discards a round superseded by a course switch instead of leaking it into the new room", async () => {
    let resolveFirstRound: ((response: Response) => void) | undefined;
    const firstRound = new Promise<Response>((resolve) => {
      resolveFirstRound = resolve;
    });
    let round = 0;
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB]),
      chatroom: () => {
        round += 1;
        return round === 1
          ? firstRound
          : Response.json({
              status: "cue-user",
              turns: [{ agentId: "research-assistant", content: "课程B的回复。" }],
              progress: [],
              orchestration: {},
            });
      },
    });

    const { container } = renderSignedInChatroom();
    await screen.findByText("选择聊天室课程");
    fireEvent.click(screen.getByRole("button", { name: /课程A/ }));
    await waitForCourseA();

    sendMessage(container, "@研究助教 课程A的问题");
    await screen.findByText("智能体思考中…");

    // A learner must be able to leave a slow room, so the chip and picker stay
    // clickable while the round is in flight.
    fireEvent.click(screen.getByRole("button", { name: /课程A · A班/ }));
    fireEvent.click(screen.getByRole("button", { name: /课程B/ }));
    await screen.findByText(courseBLabel);

    resolveFirstRound?.(
      Response.json({
        status: "cue-user",
        turns: [{ agentId: "research-assistant", content: "课程A的迟到回复。" }],
        progress: [],
        orchestration: {},
      }),
    );
    await settleInFlightRound();

    // Course A's reply never reaches course B's room, and the superseded round
    // leaves the new room usable rather than stuck "thinking".
    expect(screen.queryByText("课程A的迟到回复。")).toBeNull();
    expect(screen.queryByText("智能体思考中…")).toBeNull();
    expect(screen.getByText(emptyChatCopy)).toBeTruthy();
    const sendButton = screen.getByRole("button", { name: /发送/ }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);
    expect(composerInput(container).disabled).toBe(false);

    sendMessage(container, "@研究助教 课程B的问题");
    await screen.findByText("课程B的回复。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(2);
    const secondBody = posts[1].body as unknown as ChatroomRequestBody;
    expect(secondBody.courseId).toBe("course-b");
    // Only course B's own message: no course-A student turn and no discarded
    // agent turn are replayed as course-B history.
    expect(secondBody.messages).toHaveLength(1);
    expect(secondBody.messages[0].content).toBe("@研究助教 课程B的问题");
    expect(screen.queryByText("课程A的迟到回复。")).toBeNull();
  });

  it("still applies an in-flight round when the picker detour lands back on the same course", async () => {
    let resolveRound: ((response: Response) => void) | undefined;
    const deferred = new Promise<Response>((resolve) => {
      resolveRound = resolve;
    });
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB]),
      chatroom: () => deferred,
    });

    const { container } = renderSignedInChatroom();
    await screen.findByText("选择聊天室课程");
    fireEvent.click(screen.getByRole("button", { name: /课程A/ }));
    await waitForCourseA();

    sendMessage(container, "@研究助教 课程A的问题");
    await screen.findByText("智能体思考中…");

    // Reopening the picker and re-picking the same course does not change the
    // room, so the round is not superseded.
    fireEvent.click(screen.getByRole("button", { name: /课程A · A班/ }));
    fireEvent.click(screen.getByRole("button", { name: /课程A/ }));
    await waitForCourseA();

    resolveRound?.(
      Response.json({
        status: "cue-user",
        turns: [{ agentId: "research-assistant", content: "课程A的回复。" }],
        progress: [],
        orchestration: {},
      }),
    );

    await screen.findByText("课程A的回复。");
    expectBubbleWithText("@研究助教 课程A的问题");
    await waitFor(() => expect(screen.queryByText("智能体思考中…")).toBeNull());
    expect(composerInput(container).disabled).toBe(false);
  });

  it("treats a parseable but malformed student courses body as a load failure", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => Response.json({ memberships: null }),
    });

    const { container } = renderSignedInChatroom();
    // An enrolled learner must never be told to go join a course because the
    // roster came back in the wrong shape.
    await screen.findByText(courseLoadFailedCopy);
    expect(screen.queryByText(joinCoursePrompt)).toBeNull();
    expect(composerInput(container).disabled).toBe(true);

    sendMessage(container, "课程列表结构异常时的消息");
    expect(chatroomCalls(calls)).toHaveLength(0);
  });

  it("closes the composer for a teacher when the course fetch fails", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => new Response("", { status: 500 }),
    });

    const { container } = renderSignedInChatroom(teacherUser);
    await screen.findByText(courseLoadFailedCopy);
    expect(screen.queryByText(joinCoursePrompt)).toBeNull();

    // The demo carve-out only covers the genuine no-courses case; on a failed
    // load the teacher may well own a course, so posting the demo courseId is
    // not an acceptable stand-in.
    const input = composerInput(container);
    expect(input.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: /发送/ }) as HTMLButtonElement).disabled,
    ).toBe(true);

    sendMessage(container, "老师在课程加载失败时的消息");
    expect(chatroomCalls(calls)).toHaveLength(0);
  });

  it("treats a malformed teacher courses body as a load failure too", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => Response.json({ courses: "oops" }),
    });

    const { container } = renderSignedInChatroom(teacherUser);
    await screen.findByText(courseLoadFailedCopy);
    expect(screen.queryByText(joinCoursePrompt)).toBeNull();
    expect(composerInput(container).disabled).toBe(true);

    sendMessage(container, "老师遇到结构异常的课程列表");
    expect(chatroomCalls(calls)).toHaveLength(0);
  });

  it("skips every network call and asks for sign-in when there is no session user", async () => {
    const { fetchMock, calls } = stubFetch();

    const { container } = render(<LearningChatroomPage />);
    sendMessage(container, "未登录也想提问 @写作助手");

    await screen.findByText("请先登录，再与智能体对话。");
    expectBubbleWithText("未登录也想提问 @写作助手");
    expect(chatroomCalls(calls)).toHaveLength(0);
    // Learning-record emission is already guarded on the student account, and
    // the course fetch is skipped without a session, so a signed-out send must
    // stay fully offline.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restores the stored transcript when the course resolves and replays it as history", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA]),
      chatroomHistory: () =>
        storedTranscriptResponse([
          { id: "local-earlier", role: "student", content: "上次我问过变量定义。" },
          {
            id: "agent-earlier",
            role: "agent",
            agentId: "research-assistant",
            content: "上次研究助教的回答。",
          },
        ]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [
            {
              messageId: "agent-live-1",
              agentId: "research-assistant",
              content: "这次的回答。",
            },
          ],
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    await screen.findByText("上次研究助教的回答。");
    expect(screen.getByText("上次我问过变量定义。")).toBeTruthy();
    expect(screen.queryByText(emptyChatCopy)).toBeNull();

    const historyReads = chatroomHistoryCalls(calls);
    expect(historyReads).toHaveLength(1);
    expect(historyReads[0].url).toContain("courseId=course-a");
    expect(historyReads[0].url).toContain("classId=class-a");

    sendMessage(container, "@研究助教 接着上次的问题");
    await screen.findByText("这次的回答。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(1);
    const body = posts[0].body as unknown as ChatroomRequestBody;
    // The class scopes the stored room, so the round has to name it too.
    expect(body.classId).toBe("class-a");
    // Restored messages are posted back under their stored ids, so the server
    // append stays idempotent instead of duplicating the whole transcript.
    expect(body.messages.map((message) => message.id)).toEqual([
      "local-earlier",
      "agent-earlier",
      expect.any(String),
    ]);
    expectNoSeedMessages(body);
  });

  it("renders a live turn under the id the room stored it as", async () => {
    let round = 0;
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA]),
      chatroom: () => {
        round += 1;
        return Response.json({
          status: "cue-user",
          turns: [
            {
              messageId: `agent-stored-${round}`,
              agentId: "research-assistant",
              content: `第${round}轮回复。`,
            },
          ],
          progress: [],
          orchestration: {},
        });
      },
    });

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    sendMessage(container, "@研究助教 第一问");
    await screen.findByText("第1轮回复。");
    sendMessage(container, "@研究助教 第二问");
    await screen.findByText("第2轮回复。");

    const posts = chatroomCalls(calls);
    expect(posts).toHaveLength(2);
    const secondBody = posts[1].body as unknown as ChatroomRequestBody;
    expect(secondBody.messages[1].id).toBe("agent-stored-1");
    // Two sends in one session must never reuse a message id, or the second
    // would be silently deduplicated against the first.
    expect(secondBody.messages[0].id).not.toBe(secondBody.messages[2].id);
  });

  it("skips the transcript read for the read-only demo preview", async () => {
    const { calls } = stubFetch({
      teachingCourses: () =>
        Response.json({ courses: [], classes: [], memberships: [] }),
    });

    renderSignedInChatroom();
    await waitForDemoCourse();
    await screen.findByText(joinCoursePrompt);
    await settleInFlightRound();

    // Without an approved membership the endpoint could only answer 403, so the
    // room never asks for a transcript it may not read.
    expect(chatroomHistoryCalls(calls)).toHaveLength(0);
  });

  it("starts an empty room without a chat error when the transcript read fails", async () => {
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA]),
      chatroomHistory: () => new Response("", { status: 500 }),
    });

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    await settleInFlightRound();

    // Missing history is the pre-persistence behaviour, not something the
    // learner can act on, so it must not surface as a chat failure.
    expect(screen.getByText(emptyChatCopy)).toBeTruthy();
    expect(screen.queryByText("智能服务暂时不可用，请稍后再试。")).toBeNull();
    expect(composerInput(container).disabled).toBe(false);
  });

  it("reloads the transcript for the room the learner switches into", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB]),
      chatroomHistory: (url) =>
        url.includes("courseId=course-a")
          ? storedTranscriptResponse([
              { id: "stored-a", role: "student", content: "课程A的旧消息。" },
            ])
          : storedTranscriptResponse([
              { id: "stored-b", role: "student", content: "课程B的旧消息。" },
            ]),
    });

    renderSignedInChatroom();
    await screen.findByText("选择聊天室课程");
    fireEvent.click(screen.getByRole("button", { name: /课程A/ }));
    await screen.findByText("课程A的旧消息。");

    fireEvent.click(screen.getByRole("button", { name: /课程A · A班/ }));
    fireEvent.click(screen.getByRole("button", { name: /课程B/ }));
    await screen.findByText("课程B的旧消息。");

    // One course's stored room never leaks into another's.
    expect(screen.queryByText("课程A的旧消息。")).toBeNull();
    expect(chatroomHistoryCalls(calls)).toHaveLength(2);
  });

  it("keeps a message sent while the transcript loads at the end of the room", async () => {
    let resolveHistory: ((response: Response) => void) | undefined;
    const deferredHistory = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA]),
      chatroomHistory: () => deferredHistory,
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [
            {
              messageId: "agent-live",
              agentId: "research-assistant",
              content: "新的回复。",
            },
          ],
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderSignedInChatroom();
    await waitForCourseA();
    sendMessage(container, "@研究助教 边加载边提问");
    await screen.findByText("新的回复。");

    resolveHistory?.(
      storedTranscriptResponse([
        { id: "stored-earlier", role: "student", content: "更早的消息。" },
      ]),
    );
    await screen.findByText("更早的消息。");

    // A slow restore is prepended, so the message the learner just sent stays
    // where they left it: last.
    const bubbles = Array.from(container.querySelectorAll("article")).map(
      (article) => article.textContent ?? "",
    );
    const restoredIndex = bubbles.findIndex((text) => text.includes("更早的消息。"));
    const liveIndex = bubbles.findIndex((text) => text.includes("新的回复。"));
    expect(restoredIndex).toBeGreaterThan(-1);
    expect(liveIndex).toBeGreaterThan(restoredIndex);
  });
});
