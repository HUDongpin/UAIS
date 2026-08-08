// Phase 3 (S04) group-chatroom UI coverage: group resolution (auto-enter,
// picker, `?groupId=` deep link, no-group notice, silent feature-not-enabled
// fallback), identity rendering from the server-computed `isSelf` and
// `authorName`, the roster echoed by GET, mention chips in both locales,
// teacher observer mode, and the 5s visibility-aware polling loop with its
// 429 back-off.
//
// Same house harness as `learning-chatroom-live.test.tsx`: stubbed `fetch`,
// SessionUserProvider, fake timers where the poll interval matters, no sleeps.

import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { resetReportedLearningEventsForTesting } from "@/lib/learning-records/client-event-reporter";
import type { UaisAppSessionUser } from "@/lib/auth/uais-app-session";

const studentUser: UaisAppSessionUser = {
  account: "PeterChen",
  role: "student",
  displayName: "陈可",
  department: "UAIS",
};

const teacherUser: UaisAppSessionUser = {
  account: "teacher-kang",
  role: "teacher",
  displayName: "康霞",
  department: "UAIS",
};

const groupNoGroupCopy = "你还没有被分入小组，请联系老师。";
const observerNoticeCopy = "教师以旁听身份查看，本页只读。";
const groupPickerCopy = "选择小组";
const emptyChatCopy = "暂无聊天内容。发送第一条小组消息即可开始协作。";

type FetchCall = {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
};

type StubOptions = {
  chatroom?: () => Promise<Response> | Response;
  chatroomHistory?: (url: string, callIndex: number) => Promise<Response> | Response;
  teachingCourses?: () => Promise<Response> | Response;
};

function stubFetch(options: StubOptions = {}) {
  const calls: FetchCall[] = [];
  let historyCallIndex = 0;
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
      return options.teachingCourses
        ? options.teachingCourses()
        : Response.json({ courses: [], classes: [], memberships: [], learningGroups: [] });
    }
    if (url.includes("/api/learning/chatroom")) {
      if (method === "GET") {
        const index = historyCallIndex;
        historyCallIndex += 1;
        return options.chatroomHistory
          ? options.chatroomHistory(url, index)
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

function historyCalls(calls: FetchCall[]) {
  return calls.filter(
    (call) => call.url.includes("/api/learning/chatroom") && call.method === "GET",
  );
}

function roundCalls(calls: FetchCall[]) {
  return calls.filter(
    (call) => call.url.includes("/api/learning/chatroom") && call.method === "POST",
  );
}

const courseA = {
  courseId: "course-a",
  courseName: "大学研究方法",
  classId: "class-a",
  className: "A班",
  semester: "2026春",
};

const courseB = {
  courseId: "course-b",
  courseName: "论文写作",
  classId: "class-b",
  className: "B班",
  semester: "2026春",
};

type StudentVisibleGroup = {
  groupId: string;
  courseId: string;
  classId?: string;
  groupName: string;
  members: Array<{ displayName: string; isSelf: boolean }>;
};

const groupThree: StudentVisibleGroup = {
  groupId: "group-three",
  courseId: courseA.courseId,
  classId: courseA.classId,
  groupName: "第三小组",
  members: [
    { displayName: "陈可", isSelf: true },
    { displayName: "林若晨", isSelf: false },
  ],
};

const groupFour: StudentVisibleGroup = {
  groupId: "group-four",
  courseId: courseA.courseId,
  classId: courseA.classId,
  groupName: "第四小组",
  members: [
    { displayName: "陈可", isSelf: true },
    { displayName: "赵铭", isSelf: false },
  ],
};

type CourseFixture = typeof courseA;

function studentCoursesResponse(
  fixtures: CourseFixture[],
  learningGroups: StudentVisibleGroup[] = [],
) {
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
    learningGroups,
  });
}

// Teachers receive the raw group records for the courses they own, so the
// roster arrives as `{studentId, studentDisplayName}` rather than the narrowed
// student projection.
function teacherCoursesResponse(fixtures: CourseFixture[]) {
  return Response.json({
    courses: fixtures.map((fixture) => ({
      courseId: fixture.courseId,
      courseName: fixture.courseName,
      semester: fixture.semester,
    })),
    classes: [],
    memberships: [],
    learningGroups: [
      {
        groupId: groupThree.groupId,
        courseId: groupThree.courseId,
        classId: groupThree.classId,
        ownerTeacherId: teacherUser.account,
        groupName: groupThree.groupName,
        members: [
          { studentId: "PeterChen", studentDisplayName: "陈可", addedAt: "2026-08-01T00:00:00.000Z" },
          { studentId: "LinRuochen", studentDisplayName: "林若晨", addedAt: "2026-08-01T00:00:00.000Z" },
        ],
      },
    ],
  });
}

type GroupTranscriptMessage = {
  id: string;
  role: "student" | "agent";
  content: string;
  agentId?: string;
  authorName?: string;
  isSelf?: boolean;
};

// Mirrors the Phase 2 GET projection for a group room: `groupId`, `groupName`,
// display-name-only roster, and per-message `authorName?` + server `isSelf`.
function groupTranscriptResponse(
  messages: GroupTranscriptMessage[],
  overrides: Partial<StudentVisibleGroup> = {},
) {
  const group = { ...groupThree, ...overrides };
  return Response.json({
    courseId: group.courseId,
    classId: group.classId,
    groupId: group.groupId,
    groupName: group.groupName,
    members: group.members,
    messages: messages.map((message) => ({
      createdAt: "2026-08-01T02:30:00.000Z",
      isSelf: false,
      ...message,
    })),
    transcript: { status: "loaded", messageCount: messages.length },
    redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
  });
}

function accessDeniedResponse(reasonCode: string) {
  return Response.json(
    {
      error: "denied",
      access: { status: "denied", reasonCode },
      redaction: { secrets: "omitted", localFiles: "omitted", assets: "ids-only" },
    },
    { status: 403 },
  );
}

function renderChatroom(user: UaisAppSessionUser = studentUser) {
  return render(
    <SessionUserProvider initialSessionUser={user}>
      <LearningChatroomPage />
    </SessionUserProvider>,
  );
}

// Lets the mount fetch chain (courses -> resolution -> first history read)
// settle without leaning on wall-clock time.
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advancePoll(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
  }
}

function bubbles() {
  return Array.from(document.querySelectorAll("article"));
}

function bubbleWith(text: string) {
  return bubbles().find((bubble) => (bubble.textContent ?? "").includes(text));
}

function rowOf(bubble: Element) {
  return bubble.parentElement as HTMLElement;
}

function avatarOf(bubble: Element) {
  return rowOf(bubble).querySelector<HTMLElement>(":scope > span[aria-hidden='true']");
}

function rosterPanel() {
  return document.querySelector<HTMLElement>('[data-uais-chatroom-zone="roster"]');
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("learner chatroom group room UI", () => {
  afterEach(() => {
    mockPreferences.locale = "zh-CN";
    resetReportedLearningEventsForTesting();
    setDocumentHidden(false);
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("auto-enters the only assigned group and reads that group's room", async () => {
    // Fake timers so the armed 5s poll interval cannot fire a second GET before
    // the exact-count assertion below reads it.
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText("第三小组")).toBeTruthy();

    const reads = historyCalls(calls);
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toContain("courseId=course-a");
    expect(reads[0].url).toContain("groupId=group-three");
    // Nothing to choose between, so the group step never shows.
    expect(screen.queryByText(groupPickerCopy)).toBeNull();
  });

  it("renders the roster from the GET projection with the self member badged", async () => {
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse([], {
          members: [
            { displayName: "陈可", isSelf: true },
            { displayName: "林若晨", isSelf: false },
            { displayName: "赵铭", isSelf: false },
          ],
        }),
    });

    renderChatroom();
    await screen.findByText("第三小组");
    await settle();

    const roster = rosterPanel();
    expect(roster).toBeTruthy();
    const memberRows = Array.from(roster?.querySelectorAll("li") ?? []).map(
      (row) => row.textContent ?? "",
    );
    // Three members plus the four agents; the server roster replaced the
    // two-member discovery projection.
    expect(memberRows.filter((row) => row.includes("陈可"))).toHaveLength(1);
    expect(memberRows.some((row) => row.includes("林若晨"))).toBe(true);
    expect(memberRows.some((row) => row.includes("赵铭"))).toBe(true);
    // "我" is the self badge; only the caller's own row carries it.
    expect(memberRows.filter((row) => row.includes("我"))).toHaveLength(1);
    expect(memberRows.find((row) => row.includes("陈可"))).toContain("我");
  });

  it("renders another member's message with their name, non-self alignment and a circular avatar", async () => {
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          {
            id: "stored-other",
            role: "student",
            content: "我先整理了访谈提纲。",
            authorName: "林若晨",
            isSelf: false,
          },
        ]),
    });

    renderChatroom();
    const bubble = await screen
      .findByText("我先整理了访谈提纲。")
      .then((node) => node.closest("article") as HTMLElement);

    expect(bubble.textContent).toContain("林若晨");
    expect(rowOf(bubble).className).toContain("justify-start");
    const avatar = avatarOf(bubble);
    expect(avatar?.textContent).toBe("林");
    // Humans are circles; the rounded-square shape is reserved for agents.
    expect(avatar?.className).toContain("rounded-full");
    expect(avatar?.className).not.toContain("rounded-lg");
  });

  it("aligns a stored message to the right only when the server says it is mine", async () => {
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          {
            id: "stored-self",
            role: "student",
            content: "我在整理文献。",
            authorName: "陈可",
            isSelf: true,
          },
          {
            id: "stored-other",
            role: "student",
            content: "我来做数据清洗。",
            authorName: "林若晨",
            isSelf: false,
          },
          {
            id: "stored-agent",
            role: "agent",
            agentId: "methods-consultant",
            content: "建议先固定变量定义。",
          },
        ]),
    });

    renderChatroom();
    await screen.findByText("我在整理文献。");

    const own = bubbleWith("我在整理文献。") as HTMLElement;
    expect(rowOf(own).className).toContain("justify-end");
    // A self bubble carries no author line and no avatar.
    expect(own.textContent).not.toContain("陈可");
    expect(avatarOf(own)).toBeNull();

    const other = bubbleWith("我来做数据清洗。") as HTMLElement;
    expect(rowOf(other).className).toContain("justify-start");

    const agent = bubbleWith("建议先固定变量定义。") as HTMLElement;
    expect(agent.textContent).toContain("方法顾问");
    expect(avatarOf(agent)?.className).toContain("rounded-lg");
  });

  it("falls back to a neutral author for a pre-v2 row that carries no authorName", async () => {
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          { id: "stored-v1", role: "student", content: "旧记录里的一条消息。", isSelf: false },
        ]),
    });

    renderChatroom();
    await screen.findByText("旧记录里的一条消息。");

    const bubble = bubbleWith("旧记录里的一条消息。") as HTMLElement;
    // Never attributed to whoever happens to be reading.
    expect(bubble.textContent).toContain("同学");
    expect(rowOf(bubble).className).toContain("justify-start");
  });

  it("shows the group picker for two groups and enters the chosen one", async () => {
    // Fake timers so the poll interval cannot inflate the exact GET counts.
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree, groupFour]),
      chatroomHistory: (url) =>
        groupTranscriptResponse(
          [
            {
              id: "stored-four",
              role: "student",
              content: "第四小组的旧消息。",
              authorName: "赵铭",
              isSelf: false,
            },
          ],
          url.includes("group-four") ? groupFour : groupThree,
        ),
    });

    const { container } = renderChatroom();
    await settle();
    expect(screen.getByText(groupPickerCopy)).toBeTruthy();
    // No room is open yet, so nothing may be sent.
    expect(container.querySelector<HTMLInputElement>("#group-message")?.disabled).toBe(true);
    expect(historyCalls(calls)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /第四小组/ }));
    await settle();
    await settle();
    expect(screen.getByText("第四小组的旧消息。")).toBeTruthy();

    const reads = historyCalls(calls);
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toContain("groupId=group-four");
    expect(screen.queryByText(groupPickerCopy)).toBeNull();
    expect(container.querySelector<HTMLInputElement>("#group-message")?.disabled).toBe(false);
  });

  it("resolves a ?groupId= deep link without the link naming the course", async () => {
    // Fake timers so the poll interval cannot fire an extra GET before the
    // exact-count assertion.
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/learning/chatroom?groupId=group-four");
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB], [groupThree, groupFour]),
      chatroomHistory: () => groupTranscriptResponse([], groupFour),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText("第四小组")).toBeTruthy();

    // Two usable courses would normally open the course picker; the group record
    // names its own course, so the room resolves straight through.
    expect(screen.queryByText("选择聊天室课程")).toBeNull();
    expect(screen.queryByText(groupPickerCopy)).toBeNull();
    const reads = historyCalls(calls);
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toContain("courseId=course-a");
    expect(reads[0].url).toContain("classId=class-a");
    expect(reads[0].url).toContain("groupId=group-four");
  });

  it("posts the groupId with the round and keeps the sent message in the room", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [
            {
              messageId: "agent-live-1",
              agentId: "methods-consultant",
              content: "先把变量定义写清楚。",
            },
          ],
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await screen.findByText("第三小组");

    const input = container.querySelector<HTMLInputElement>("#group-message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "@方法顾问 变量怎么定？" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await screen.findByText("先把变量定义写清楚。");

    const posts = roundCalls(calls);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual(
      expect.objectContaining({ courseId: "course-a", groupId: "group-three" }),
    );
  });

  it("shows the no-group notice when the caller has groups but none in this room", async () => {
    window.history.replaceState({}, "", "/learning/chatroom?courseId=course-b");
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA, courseB], [groupThree]),
    });

    renderChatroom();
    await screen.findByText(groupNoGroupCopy);
    await settle();
    // The legacy per-student room still works; the notice is informational.
    expect(screen.getByText(emptyChatCopy)).toBeTruthy();
  });

  it("stays quiet and legacy when the caller has no groups at all", async () => {
    // Fake timers so the legacy room's poll interval cannot fire a second GET
    // before the exact-count assertion.
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], []),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText("当前课程：大学研究方法 · A班 · 2026春")).toBeTruthy();

    expect(screen.queryByText(groupNoGroupCopy)).toBeNull();
    const reads = historyCalls(calls);
    expect(reads).toHaveLength(1);
    expect(reads[0].url).not.toContain("groupId");
    expect(container.querySelector<HTMLInputElement>("#group-message")?.disabled).toBe(false);
  });

  it("keeps a legacy room's stored student rows attributed to the reader", async () => {
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], []),
      chatroomHistory: () =>
        Response.json({
          messages: [
            {
              id: "stored-legacy",
              role: "student",
              content: "上次我问过变量定义。",
              createdAt: "2026-08-01T02:30:00.000Z",
            },
          ],
          transcript: { status: "loaded", messageCount: 1 },
        }),
    });

    renderChatroom();
    await screen.findByText("上次我问过变量定义。");

    // No groupId in the response means a private room: every stored student row
    // is the reader's own, exactly as before groups existed.
    const bubble = bubbleWith("上次我问过变量定义。") as HTMLElement;
    expect(rowOf(bubble).className).toContain("justify-end");
    expect(avatarOf(bubble)).toBeNull();
  });

  it("drops the group and re-reads the legacy room when the deployment answers feature-not-enabled", async () => {
    // Fake timers so the two expected GETs (group read, then the legacy re-read
    // after the group is dropped) are not joined by a poll-interval third read.
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: (url) =>
        url.includes("groupId")
          ? accessDeniedResponse("feature-not-enabled")
          : Response.json({
              messages: [
                {
                  id: "stored-legacy",
                  role: "student",
                  content: "私有房间里的旧消息。",
                  createdAt: "2026-08-01T02:30:00.000Z",
                },
              ],
              transcript: { status: "loaded", messageCount: 1 },
            }),
    });

    renderChatroom();
    // Two hops: courses -> group read (feature-not-enabled) -> group dropped ->
    // legacy re-read. A few microtask flushes let both settle without the poll
    // interval advancing.
    await settle();
    await settle();
    await settle();
    expect(screen.getByText("私有房间里的旧消息。")).toBeTruthy();

    const reads = historyCalls(calls);
    expect(reads).toHaveLength(2);
    expect(reads[0].url).toContain("groupId=group-three");
    expect(reads[1].url).not.toContain("groupId");
    // Nothing about the flag is the learner's problem, so nothing is announced.
    expect(screen.queryByText(groupNoGroupCopy)).toBeNull();
  });

  it("stops polling a denied group room and explains it once", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => accessDeniedResponse("student-group-membership-required"),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText(groupNoGroupCopy)).toBeTruthy();

    const before = historyCalls(calls).length;
    await advancePoll(3);
    // A denial does not change with time; re-polling would only spend the shared
    // GET budget.
    expect(historyCalls(calls)).toHaveLength(before);
  });

  it("renders localized mention chips in the bubble in both locales", async () => {
    const history = () =>
      groupTranscriptResponse([
        {
          id: "stored-mention",
          role: "student",
          content: "@方法顾问 变量怎么定？",
          authorName: "林若晨",
          isSelf: false,
        },
      ]);

    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: history,
    });

    const zh = renderChatroom();
    // The handle also labels the roster and dock rows, so the bubble is found by
    // the text run that follows its chip.
    await screen.findByText("变量怎么定？");
    const zhChips = Array.from(
      document.querySelectorAll<HTMLElement>("article [data-uais-chatroom-mention]"),
    );
    expect(zhChips).toHaveLength(1);
    expect(zhChips[0].dataset.uaisChatroomMention).toBe("methods-consultant");
    expect(zhChips[0].textContent).toBe("@方法顾问");
    zh.unmount();

    vi.unstubAllGlobals();
    mockPreferences.locale = "en-US";
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: history,
    });

    renderChatroom();
    // Only the handle is localized; the rest of the stored content is identical.
    await screen.findByText("变量怎么定？");
    const enChips = Array.from(
      document.querySelectorAll<HTMLElement>("article [data-uais-chatroom-mention]"),
    );
    expect(enChips).toHaveLength(1);
    // The transcript stored the Chinese handle; the chip is spelled in the
    // reading locale.
    expect(enChips[0].textContent).toBe("@MethodsAdvisor");
  });

  it("renders the observer notice and no composer for a teacher on a group deep link", async () => {
    window.history.replaceState({}, "", "/learning/chatroom?groupId=group-three");
    const { calls } = stubFetch({
      teachingCourses: () => teacherCoursesResponse([courseA]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          {
            id: "stored-other",
            role: "student",
            content: "老师能看到这条吗？",
            authorName: "林若晨",
            isSelf: false,
          },
        ]),
    });

    const { container } = renderChatroom(teacherUser);
    await screen.findByText("老师能看到这条吗？");

    expect(screen.getByText(observerNoticeCopy)).toBeTruthy();
    expect(container.querySelector("#group-message")).toBeNull();
    expect(screen.queryByRole("button", { name: /发送/ })).toBeNull();
    expect(screen.getByText("旁听")).toBeTruthy();
    // The teacher's own raw group record supplies the roster before the first
    // read lands; neither shape ever carries an account id.
    const roster = rosterPanel();
    expect(roster?.textContent).toContain("林若晨");
    expect(roster?.textContent).not.toContain("LinRuochen");
    expect(historyCalls(calls)[0].url).toContain("groupId=group-three");
  });

  it("keeps a teacher out of group rooms unless a deep link asks for one", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => teacherCoursesResponse([courseA]),
    });

    renderChatroom(teacherUser);
    await screen.findByText("当前课程：大学研究方法 · 2026春");
    await settle();

    expect(screen.queryByText(observerNoticeCopy)).toBeNull();
    expect(historyCalls(calls)[0].url).not.toContain("groupId");
  });

  it("merges a message another member sent while this room was open", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: (_url, index) =>
        index === 0
          ? groupTranscriptResponse([
              {
                id: "stored-1",
                role: "student",
                content: "我先开个头。",
                authorName: "陈可",
                isSelf: true,
              },
            ])
          : groupTranscriptResponse([
              {
                id: "stored-1",
                role: "student",
                content: "我先开个头。",
                authorName: "陈可",
                isSelf: true,
              },
              {
                id: "stored-2",
                role: "student",
                content: "我补充一个访谈问题。",
                authorName: "林若晨",
                isSelf: false,
              },
            ]),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText("我先开个头。")).toBeTruthy();
    expect(screen.queryByText("我补充一个访谈问题。")).toBeNull();
    expect(historyCalls(calls)).toHaveLength(1);

    await advancePoll();

    expect(screen.getByText("我补充一个访谈问题。")).toBeTruthy();
    expect(historyCalls(calls)).toHaveLength(2);
    // Merged by messageId: the row the room already had is not duplicated.
    expect(bubbles().filter((bubble) => bubble.textContent?.includes("我先开个头。"))).toHaveLength(1);
  });

  it("refreshes agent round status from a poll another member's round produced", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: (_url, index) =>
        index === 0
          ? groupTranscriptResponse([])
          : groupTranscriptResponse([
              {
                id: "stored-agent",
                role: "agent",
                agentId: "math-tutor",
                content: "这道题可以先配方。",
              },
            ]),
    });

    renderChatroom();
    await settle();
    await settle();
    const roster = rosterPanel();
    const mathRow = () =>
      Array.from(roster?.querySelectorAll("li") ?? []).find((row) =>
        row.textContent?.includes("@数学助教"),
      );
    expect(mathRow()?.textContent).toContain("待命");

    await advancePoll();

    expect(mathRow()?.textContent).toContain("已回复");
  });

  it("pauses polling while the tab is hidden and reads immediately on return", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(historyCalls(calls)).toHaveLength(1);

    await act(async () => {
      setDocumentHidden(true);
    });
    await advancePoll(3);
    expect(historyCalls(calls)).toHaveLength(1);

    await act(async () => {
      setDocumentHidden(false);
    });
    await settle();
    // Coming back reads at once rather than waiting out the interval.
    expect(historyCalls(calls)).toHaveLength(2);
  });

  it("keeps the thread and backs off when the history read is rate limited", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: (_url, index) =>
        index === 0
          ? groupTranscriptResponse([
              {
                id: "stored-1",
                role: "student",
                content: "限流前就在房间里的消息。",
                authorName: "林若晨",
                isSelf: false,
              },
            ])
          : Response.json({ error: "rate limited" }, { status: 429 }),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText("限流前就在房间里的消息。")).toBeTruthy();

    await advancePoll();
    expect(historyCalls(calls)).toHaveLength(2);
    // A 429 must never blank the room.
    expect(screen.getByText("限流前就在房间里的消息。")).toBeTruthy();
    expect(screen.queryByText(emptyChatCopy)).toBeNull();

    // Backed off for at least two intervals, so the next tick is skipped.
    await advancePoll();
    expect(historyCalls(calls)).toHaveLength(2);

    await advancePoll();
    expect(historyCalls(calls)).toHaveLength(3);
    expect(screen.getByText("限流前就在房间里的消息。")).toBeTruthy();
  });

  it("keeps the thinking-indicator dots motion-safe for reduced motion", async () => {
    // Fake timers so the armed poll interval does not fire while the round is
    // deferred; the indicator only needs a pending round to render.
    vi.useFakeTimers();
    let resolveTurn: ((response: Response) => void) | undefined;
    const deferred = new Promise<Response>((resolve) => {
      resolveTurn = resolve;
    });
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () => deferred,
    });
    const { container } = renderChatroom();

    await settle();
    await settle();
    expect(screen.getByText("第三小组")).toBeTruthy();

    const input = container.querySelector<HTMLInputElement>("#group-message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "@方法顾问 在吗？" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await settle();

    // The thinking indicator is on screen while the deferred round is pending.
    const thinking = screen.getByText("智能体思考中…").closest("article") as HTMLElement;
    const dots = Array.from(thinking.querySelectorAll("span")).filter((span) =>
      span.className.includes("animate-pulse"),
    );
    expect(dots).toHaveLength(3);
    // Each animated dot opts out of animation under prefers-reduced-motion.
    dots.forEach((dot) => expect(dot.className).toContain("motion-reduce:animate-none"));

    // Let the round finish so it does not dangle past the test.
    resolveTurn?.(Response.json({ status: "end", turns: [], progress: [], orchestration: {} }));
    await settle();
  });
});
