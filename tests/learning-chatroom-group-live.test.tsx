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
import {
  isThreadNearBottom,
  resolveThreadAutoScroll,
} from "@/components/pages/learning-chatroom-thread-scroll";
import {
  chatroomPollIntervalMs,
  formatShareExpiry,
} from "@/components/pages/use-learning-chatroom";
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
const instructorRowCopy = "授课教师";
const instructorBadgeCopy = "教师";
const groupPickerCopy = "选择小组";
const emptyChatCopy = "暂无聊天内容。发送第一条小组消息即可开始协作。";

type FetchCall = {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
};

type StubOptions = {
  // The call index lets a test answer the same round differently on a retry,
  // which is how the delivery-receipt cases below are written.
  chatroom?: (callIndex: number) => Promise<Response> | Response;
  chatroomHistory?: (url: string, callIndex: number) => Promise<Response> | Response;
  teachingCourses?: () => Promise<Response> | Response;
  // Teacher moderation and share minting. Both live under
  // `/api/learning/chatroom/...`, so the router below matches them BEFORE the
  // room's own endpoint or every moderation call would be answered as a round.
  moderation?: (callIndex: number) => Promise<Response> | Response;
  share?: () => Promise<Response> | Response;
  // DELETE /api/learning/chatroom/share/[shareId].
  shareRevoke?: () => Promise<Response> | Response;
};

function stubFetch(options: StubOptions = {}) {
  const calls: FetchCall[] = [];
  let historyCallIndex = 0;
  let roundCallIndex = 0;
  let moderationCallIndex = 0;
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
    if (url.includes("/api/learning/chatroom/moderation")) {
      const index = moderationCallIndex;
      moderationCallIndex += 1;
      return options.moderation
        ? options.moderation(index)
        : Response.json({ action: "hide-message", receipt: { status: "applied" } });
    }
    if (url.includes("/api/learning/chatroom/share")) {
      // Mint and revoke share one path prefix and are told apart by the verb,
      // exactly as the routes are.
      if (method === "DELETE") {
        return options.shareRevoke
          ? options.shareRevoke()
          : Response.json({ receipt: { status: "revoked" } });
      }
      return options.share
        ? options.share()
        : Response.json({ share: { shareId: "share-1" } }, { status: 201 });
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
      const roundIndex = roundCallIndex;
      roundCallIndex += 1;
      return options.chatroom
        ? options.chatroom(roundIndex)
        : Response.json({ status: "end", turns: [], progress: [], orchestration: {} });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function historyCalls(calls: FetchCall[]) {
  return calls.filter(
    (call) =>
      call.url.includes("/api/learning/chatroom/history?") && call.method === "GET",
  );
}

function roundCalls(calls: FetchCall[]) {
  return calls.filter(
    (call) =>
      call.url.endsWith("/api/learning/chatroom") && call.method === "POST",
  );
}

function moderationCalls(calls: FetchCall[]) {
  return calls.filter((call) =>
    call.url.includes("/api/learning/chatroom/moderation"),
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
  // The two room facts E10 added to the GET: whether the teacher has frozen the
  // room, and whether its rolling window is full. Both default to the quiet
  // case, so every existing case below keeps the shape it was written against.
  roomState: { frozen?: boolean; windowAtCapacity?: boolean } = {},
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
    transcript: {
      status: "loaded",
      messageCount: messages.length,
      window: {
        maxMessages: 500,
        atCapacity: roomState.windowAtCapacity === true,
      },
    },
    moderation: { status: roomState.frozen ? "frozen" : "open" },
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

// Advances exactly one poll interval, read from the hook rather than hardcoded.
// These assertions count history reads, so a literal here silently doubles
// every count the moment the interval changes - which is what happened when it
// moved from 5s to 2.5s.
async function advancePoll(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(chatroomPollIntervalMs);
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

// Shared by both describes below so a second suite in this file cannot drift
// from the first one's teardown.
function resetChatroomHarness() {
  mockPreferences.locale = "zh-CN";
  resetReportedLearningEventsForTesting();
  setDocumentHidden(false);
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

describe("learner chatroom group room UI", () => {
  afterEach(resetChatroomHarness);

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

  it("gives a teacher on a group deep link a composer and the instructor identity", async () => {
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

    // Teaching presence (owner decision): the teacher speaks in the room rather
    // than watching it, so the composer is present and the header identifies
    // them as the instructor.
    expect(container.querySelector("#group-message")).toBeTruthy();
    expect(screen.getByRole("button", { name: /发送/ })).toBeTruthy();
    expect(screen.getByText(instructorRowCopy)).toBeTruthy();
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

    expect(screen.queryByText(instructorRowCopy)).toBeNull();
    expect(historyCalls(calls)[0].url).not.toContain("groupId");
  });

  it("marks the teacher's turn as instructor guidance for a member", async () => {
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          {
            id: "stored-teacher",
            role: "student",
            content: "记得先确定变量再收集数据。",
            authorName: "吴亚军",
            authorRole: "teacher",
            isSelf: false,
          },
          {
            id: "stored-peer",
            role: "student",
            content: "收到，我来整理编码表。",
            authorName: "林若晨",
            isSelf: false,
          },
        ]),
    });

    renderChatroom(studentUser);
    const teacherText = await screen.findByText("记得先确定变量再收集数据。");
    const peerText = await screen.findByText("收到，我来整理编码表。");

    // Only the teacher's row is badged: a classmate's turn carries no role, so
    // the badge marks guidance rather than decorating every non-self message.
    const teacherBubble = teacherText.closest("article");
    const peerBubble = peerText.closest("article");
    expect(
      teacherBubble?.querySelector('[data-uais-chatroom-instructor="true"]'),
    ).toBeTruthy();
    expect(teacherBubble?.textContent).toContain(instructorBadgeCopy);
    expect(
      peerBubble?.querySelector('[data-uais-chatroom-instructor="true"]'),
    ).toBeNull();
    expect(historyCalls(calls)[0].url).toContain("groupId=group-three");
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

// Delivery receipts (S04 + S12 contract).
//
// Persistence is best-effort by design: the route answers 200 for a round it
// could not store, reporting `transcript.status: "unavailable"` in the body. The
// client used to read only `response.ok`, so a message that reached no store —
// and that no classmate's poll would ever deliver — rendered exactly like one
// the room had kept. These cases pin the four places that now depend on the
// receipt instead of on the status code.

const undeliveredCopy = "未送达，点按重试";
const historyUnavailableCopy = "历史记录暂不可用，当前仅显示本次会话的消息。";

function undeliveredControl() {
  return document.querySelector<HTMLButtonElement>(
    '[data-uais-chatroom-undelivered="true"]',
  );
}

function historyNotice() {
  return document.querySelector<HTMLElement>(
    '[data-uais-chatroom-history-notice="true"]',
  );
}

function composerOf(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>("#group-message") as HTMLInputElement;
}

async function sendMessage(container: HTMLElement, text: string) {
  const input = composerOf(container);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await settle();
  await settle();
}

// Ids of the student rows a POST carried, in order. The last one is the message
// that round was sending, which is what a retry has to re-post unchanged.
function postedMessageIds(call: FetchCall) {
  const messages = (call.body?.messages ?? []) as Array<{ id: string }>;
  return messages.map((message) => message.id);
}

// collaboration.contributed writes, which the harness answers 202 for.
function contributionCalls(calls: FetchCall[]) {
  return calls.filter(
    (call) =>
      call.url.includes("/api/learning-records/events") &&
      (call.body?.event as { type?: string } | undefined)?.type ===
        "collaboration.contributed",
  );
}

describe("learner chatroom delivery receipts", () => {
  afterEach(resetChatroomHarness);

  it("marks a message the room never stored as undelivered instead of delivered", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      // A plain message: no agent is addressed, so the route takes its fast
      // path and the only thing the round had to do was persist — which is
      // exactly what the receipt says did not happen.
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript: { status: "unavailable" },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "三点图书馆见。");

    // The bubble stays: the learner did write it, and hiding it would be its
    // own kind of lie. It is ringed and carries the retry control instead.
    const bubble = bubbleWith("三点图书馆见。") as HTMLElement;
    expect(bubble).toBeTruthy();
    expect(bubble.className).toContain("ring-[var(--danger)]");
    const retry = undeliveredControl();
    expect(retry).toBeTruthy();
    expect(retry?.textContent).toContain(undeliveredCopy);
    expect(bubble.contains(retry as Node)).toBe(true);
  });

  it("leaves a stored message unmarked when the receipt confirms the append", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript: { status: "persisted", appendedMessageCount: 1, messageCount: 1 },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "我把访谈提纲发群里了。");

    expect(bubbleWith("我把访谈提纲发群里了。")).toBeTruthy();
    expect(undeliveredControl()).toBeNull();
  });

  // E16/PKG-10: the contribution record was emitted on `response.ok`, one await
  // BEFORE the receipt was read, so a round the route answered 200 for and could
  // not store still credited participation - the learner's record claimed a
  // message no classmate would ever receive.
  it("records the contribution when the receipt confirms the message", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript: { status: "persisted", appendedMessageCount: 1, messageCount: 1 },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "我把访谈提纲发群里了。");

    const contributions = contributionCalls(calls);
    expect(contributions).toHaveLength(1);
    expect(contributions[0].body).toMatchObject({
      actorId: studentUser.account,
      event: { context: { courseId: "course-a", cohortId: "group-three" } },
    });
  });

  it("withholds the contribution while the room has not confirmed the message", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript: { status: "unavailable" },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "这条没进聊天室。");

    // The round happened and the bubble is on screen, marked undelivered - and
    // the learning record says nothing at all.
    expect(undeliveredControl()).toBeTruthy();
    expect(contributionCalls(calls)).toHaveLength(0);
  });

  it("records the withheld contribution once a later read replays the message", async () => {
    vi.useFakeTimers();
    const sentId: { current: string | undefined } = { current: undefined };
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        sentId.current
          ? groupTranscriptResponse([
              {
                id: sentId.current,
                role: "student",
                content: "这条其实写进去了。",
                authorName: "陈可",
                isSelf: true,
              },
            ])
          : groupTranscriptResponse([]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript: { status: "unavailable" },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "这条其实写进去了。");
    expect(contributionCalls(calls)).toHaveLength(0);

    // The append the route abandoned did land, and the replay is what proves it:
    // the participation the send held back is honest to credit now.
    sentId.current = postedMessageIds(roundCalls(calls)[0]).slice(-1)[0];
    await advancePoll();
    expect(contributionCalls(calls)).toHaveLength(1);

    // And exactly once: a further replay of the same row credits nothing more.
    await advancePoll();
    expect(contributionCalls(calls)).toHaveLength(1);
  });

  it("credits one message once when a poll release and a tap-to-retry both confirm it", async () => {
    // The park/release map was idempotent per PARKED ENTRY, not per message id.
    // A poll replay released the record and emptied the map; a retry already in
    // flight then resolved with a confirmed receipt, found the map empty, parked
    // the same message again and emitted it again - two
    // `collaboration.contributed` rows, each with its own unique idempotency key
    // so the server could not collapse them either. One sentence, two credits in
    // the learner's record.
    vi.useFakeTimers();
    const sentId: { current: string | undefined } = { current: undefined };
    let resolveRetry: (response: Response) => void = () => {};
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        sentId.current
          ? groupTranscriptResponse([
              {
                id: sentId.current,
                role: "student",
                content: "编码表我来整理。",
                authorName: "陈可",
                isSelf: true,
              },
            ])
          : groupTranscriptResponse([]),
      chatroom: (index) =>
        index === 0
          ? Response.json({
              status: "cue-user",
              turns: [],
              transcript: { status: "unavailable" },
              progress: [],
              orchestration: {},
            })
          : // Held open so the poll below can land FIRST, which is the ordering
            // that produced the double credit.
            new Promise<Response>((resolve) => {
              resolveRetry = resolve;
            }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "编码表我来整理。");
    expect(contributionCalls(calls)).toHaveLength(0);

    sentId.current = postedMessageIds(roundCalls(calls)[0]).slice(-1)[0];
    fireEvent.click(undeliveredControl() as HTMLButtonElement);
    await settle();

    // The append the route abandoned did land, and the replay proves it: the
    // parked record is released here.
    await advancePoll();
    expect(contributionCalls(calls)).toHaveLength(1);

    // Now the retry resolves, confirmed. It is a delivery receipt for a message
    // that has already been credited, so it must credit nothing.
    resolveRetry(
      Response.json({
        status: "cue-user",
        turns: [],
        transcript: { status: "persisted", appendedMessageCount: 1, messageCount: 1 },
        progress: [],
        orchestration: {},
      }),
    );
    await settle();
    await settle();

    expect(contributionCalls(calls)).toHaveLength(1);
    expect(undeliveredControl()).toBeNull();
  });

  it("re-posts the same message id on tap-to-retry and clears the mark when it lands", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: (index) =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript:
            index === 0
              ? { status: "unavailable" }
              : { status: "persisted", appendedMessageCount: 1, messageCount: 1 },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "我负责整理编码表。");

    const retry = undeliveredControl();
    expect(retry).toBeTruthy();
    expect(retry?.disabled).toBe(false);

    fireEvent.click(retry as HTMLButtonElement);
    await settle();
    await settle();

    const posts = roundCalls(calls);
    expect(posts).toHaveLength(2);
    // The whole point of retrying under the original id: the server append is
    // idempotent per message id, so a first write that landed late cannot be
    // doubled by the retry.
    const first = postedMessageIds(posts[0]);
    const second = postedMessageIds(posts[1]);
    expect(second[second.length - 1]).toBe(first[first.length - 1]);
    expect(second).toHaveLength(1);

    // The confirmed receipt is the only thing that clears the mark.
    expect(undeliveredControl()).toBeNull();
    expect(bubbleWith("我负责整理编码表。")).toBeTruthy();
  });

  it("keeps the message marked when the retry fails to persist as well", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript: { status: "unavailable" },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "存储还是没恢复。");

    fireEvent.click(undeliveredControl() as HTMLButtonElement);
    await settle();
    await settle();

    // Nothing is cleared optimistically: only a confirmed receipt, or a read
    // that replays the row, may say a message is in the room.
    expect(undeliveredControl()).toBeTruthy();
  });

  it("clears the mark when a later read replays the message the room did keep", async () => {
    vi.useFakeTimers();
    const sentId: { current: string | undefined } = { current: undefined };
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        sentId.current
          ? groupTranscriptResponse([
              {
                id: sentId.current,
                role: "student",
                content: "预算超时那条其实写进去了。",
                authorName: "陈可",
                isSelf: true,
              },
            ])
          : groupTranscriptResponse([]),
      chatroom: () =>
        Response.json({
          status: "cue-user",
          turns: [],
          transcript: { status: "unavailable" },
          progress: [],
          orchestration: {},
        }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "预算超时那条其实写进去了。");
    expect(undeliveredControl()).toBeTruthy();

    // "unavailable" means "not confirmed inside the budget", not "not written":
    // the append the route abandoned keeps running and may still land, and the
    // next read is what proves it.
    sentId.current = postedMessageIds(roundCalls(calls)[0]).slice(-1)[0];
    expect(sentId.current).toBeTruthy();
    await advancePoll();

    expect(undeliveredControl()).toBeNull();
    expect(bubbleWith("预算超时那条其实写进去了。")).toBeTruthy();
  });

  it("puts the typed text back in the composer when the send is throttled", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () =>
        Response.json(
          { error: "rate limited" },
          { status: 429, headers: { "retry-after": "30" } },
        ),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "@方法顾问 变量怎么定？");

    // A throttled message reached no store at all, so its bubble is pulled out
    // of the thread — and the text goes back where it was typed rather than
    // being discarded, which used to force the learner to retype it.
    expect(bubbleWith("@方法顾问 变量怎么定？")).toBeUndefined();
    expect(composerOf(container).value).toBe("@方法顾问 变量怎么定？");
    expect(screen.getByText("发送过于频繁，请在 30 秒后重试。")).toBeTruthy();
    expect(undeliveredControl()).toBeNull();
  });

  it("keeps a draft the learner started while the throttled round was in flight", async () => {
    vi.useFakeTimers();
    let releaseRound: ((response: Response) => void) | undefined;
    const deferred = new Promise<Response>((resolve) => {
      releaseRound = resolve;
    });
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () => deferred,
    });

    const { container } = renderChatroom();
    await settle();
    await settle();

    const input = composerOf(container);
    fireEvent.change(input, { target: { value: "第一条" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await settle();
    fireEvent.change(composerOf(container), { target: { value: "改主意了" } });

    releaseRound?.(
      Response.json({ error: "rate limited" }, { status: 429, headers: { "retry-after": "5" } }),
    );
    await settle();
    await settle();

    // The newer text wins: restoring over it would delete what the learner is
    // in the middle of writing.
    expect(composerOf(container).value).toBe("改主意了");
  });

  it("says the history is unavailable without blanking the thread, and takes it back", async () => {
    vi.useFakeTimers();
    const stored = [
      {
        id: "stored-1",
        role: "student" as const,
        content: "存储出问题之前的消息。",
        authorName: "林若晨",
        isSelf: false,
      },
    ];
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: (_url, index) =>
        index === 1
          ? // The store could not be read, so the route answers 200 with an
            // empty transcript. Without the receipt this is indistinguishable
            // from a healthy, quiet room.
            Response.json({
              courseId: courseA.courseId,
              classId: courseA.classId,
              groupId: groupThree.groupId,
              groupName: groupThree.groupName,
              members: groupThree.members,
              messages: [],
              transcript: { status: "unavailable", messageCount: 0 },
            })
          : groupTranscriptResponse(stored),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText("存储出问题之前的消息。")).toBeTruthy();
    expect(historyNotice()).toBeNull();

    await advancePoll();

    expect(historyNotice()?.textContent).toBe(historyUnavailableCopy);
    // The thread is never blanked for a read that failed: the learner keeps
    // every message the room already showed them.
    expect(screen.getByText("存储出问题之前的消息。")).toBeTruthy();
    expect(screen.queryByText(emptyChatCopy)).toBeNull();

    await advancePoll();

    // A read that reaches the store again withdraws the notice.
    expect(historyNotice()).toBeNull();
    expect(screen.getByText("存储出问题之前的消息。")).toBeTruthy();
  });

  it("announces an unavailable history in English too", async () => {
    mockPreferences.locale = "en-US";
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        Response.json({
          courseId: courseA.courseId,
          groupId: groupThree.groupId,
          groupName: groupThree.groupName,
          members: groupThree.members,
          messages: [],
          transcript: { status: "unavailable", messageCount: 0 },
        }),
    });

    renderChatroom();
    await settle();
    await settle();

    expect(historyNotice()?.textContent).toBe(
      "History temporarily unavailable — only this session's messages are shown.",
    );
  });

  it("treats a response with no receipt as delivered", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      // A deployment that predates the receipt must not paint every message it
      // successfully stored as failed.
      chatroom: () =>
        Response.json({ status: "cue-user", turns: [], progress: [], orchestration: {} }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "旧部署也应该正常。");

    expect(bubbleWith("旧部署也应该正常。")).toBeTruthy();
    expect(undeliveredControl()).toBeNull();
    expect(historyNotice()).toBeNull();
  });
});

// E11 (PKG-6 client): the four things the room was doing dishonestly, and the
// two capabilities it did not have at all.
//
// - "Agents are thinking…" appeared for EVERY in-flight send, including the
//   plain messages the route now persists and answers without touching a
//   provider. The indicator was claiming work nobody had asked for.
// - Tap-to-retry re-posted as an ordinary send, so the mention gate read the
//   same last student message and ran the round again: a learner who asked once
//   was answered - and billed - twice.
// - The rolling window (solo 200 / group 500) was disclosed nowhere: not the
//   room, not the export, not the share page.
// - A share link expired and nothing said when.
// - There was no teacher moderation surface at all.

const thinkingCopy = "智能体思考中…";
const windowTrimmedCopy = "较早的消息已滚动归档，导出与分享同样不含";
const frozenNoticeCopy = "本聊天室已被授课教师暂时冻结，暂时无法发送新消息。";
const hideCopy = "隐藏";
const hiddenReceiptCopy = "已隐藏，刷新后成员不再看到这条消息。";
const freezeCopy = "冻结聊天室";
const unfreezeCopy = "解除冻结";
const frozenStateCopy = "当前状态：已冻结";

function windowNotice() {
  return document.querySelector<HTMLElement>(
    '[data-uais-chatroom-window-notice="true"]',
  );
}

function frozenNotice() {
  return document.querySelector<HTMLElement>(
    '[data-uais-chatroom-frozen-notice="true"]',
  );
}

function hideControlFor(messageId: string) {
  return document.querySelector<HTMLButtonElement>(
    `[data-uais-chatroom-hide-message="${messageId}"]`,
  );
}

function freezeToggle() {
  return document.querySelector<HTMLButtonElement>(
    "[data-uais-chatroom-freeze-toggle]",
  );
}

function moderationReceipt() {
  return document.querySelector<HTMLElement>(
    '[data-uais-chatroom-moderation-receipt="true"]',
  );
}

function shareExpiry() {
  return document.querySelector<HTMLElement>(
    '[data-uais-chatroom-share-expiry="true"]',
  );
}

// Holds a round open so the in-flight state can be asserted, then releases it.
function deferredRound() {
  let release: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    finish: () =>
      release?.(
        Response.json({ status: "cue-user", turns: [], progress: [], orchestration: {} }),
      ),
  };
}

function typeAndSubmit(container: HTMLElement, text: string) {
  const input = composerOf(container);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

describe("learner chatroom honest round state", () => {
  afterEach(resetChatroomHarness);

  it("does not claim agents are thinking for a message that addresses none", async () => {
    vi.useFakeTimers();
    const round = deferredRound();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () => round.promise,
    });

    const { container } = renderChatroom();
    await settle();
    await settle();

    typeAndSubmit(container, "三点图书馆见。");
    await settle();

    // The round is genuinely in flight - the POST has not resolved - and the
    // room says nothing about agents, because none was addressed and none will
    // run. The composer stays open too: a plain message waits on a store write,
    // not on a ten-to-fifty-second provider round.
    expect(screen.queryByText(thinkingCopy)).toBeNull();
    const sendButton = screen.getByRole("button", { name: /发送/ }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);

    round.finish();
    await settle();
    expect(screen.queryByText(thinkingCopy)).toBeNull();
  });

  it("shows the thinking indicator only while a mentioned agent is answering", async () => {
    vi.useFakeTimers();
    const round = deferredRound();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () => round.promise,
    });

    const { container } = renderChatroom();
    await settle();
    await settle();

    typeAndSubmit(container, "@方法顾问 变量怎么定？");
    await settle();

    expect(screen.getByText(thinkingCopy)).toBeTruthy();
    const sendButton = screen.getByRole("button", { name: /发送/ }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    round.finish();
    await settle();
    expect(screen.queryByText(thinkingCopy)).toBeNull();
  });

  it("uses the server's own mention rule, so a pasted address summons nobody", async () => {
    vi.useFakeTimers();
    const round = deferredRound();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () => round.promise,
    });

    const { container } = renderChatroom();
    await settle();
    await settle();

    // An email-like string carrying a handle. The route's gate refuses to start
    // a round for it, so a client that showed "thinking" here would be
    // promising a reply that is never coming.
    typeAndSubmit(container, "写信给 peter@MathTA.example 就行。");
    await settle();

    expect(screen.queryByText(thinkingCopy)).toBeNull();

    round.finish();
    await settle();
  });
});

describe("learner chatroom rolling-window disclosure", () => {
  afterEach(resetChatroomHarness);

  it("says older messages have rolled out once the room is at its window cap", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse(
          [{ id: "stored-1", role: "student", content: "窗口已经满了。" }],
          {},
          { windowAtCapacity: true },
        ),
    });

    renderChatroom();
    await settle();
    await settle();

    const notice = windowNotice();
    expect(notice).toBeTruthy();
    // The wording names the export and the share link too, because those carry
    // the same cut and nothing else in either surface says so.
    expect(notice?.textContent).toBe(windowTrimmedCopy);
  });

  it("stays quiet while the room still has room", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          { id: "stored-1", role: "student", content: "刚开始聊。" },
        ]),
    });

    renderChatroom();
    await settle();
    await settle();

    expect(windowNotice()).toBeNull();
  });
});

describe("learner chatroom frozen room", () => {
  afterEach(resetChatroomHarness);

  it("tells a member the room is frozen and closes the composer", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse(
          [{ id: "stored-1", role: "student", content: "老师说先停一下。" }],
          {},
          { frozen: true },
        ),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();

    // Read from the room's own state, so the member is told BEFORE they type.
    expect(frozenNotice()?.textContent).toContain(frozenNoticeCopy);
    expect(composerOf(container).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /发送/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("closes the composer on a refused send and keeps the text out of the room", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      // The room read as open, so the freeze landed between the poll and the
      // send: the refusal is the only signal this client gets.
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: () =>
        Response.json(
          {
            error: "UAIS learning chatroom room is frozen by the course teacher.",
            reasonCode: "chatroom-room-frozen",
          },
          { status: 423 },
        ),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "还能发吗？");

    // The route refuses a frozen room BEFORE it has a room to persist into, so
    // this message reached no store. Leaving its bubble on screen would tell
    // the sender it was delivered; the text goes back to the composer instead.
    expect(bubbleWith("还能发吗？")).toBeUndefined();
    expect(composerOf(container).value).toBe("还能发吗？");
    expect(frozenNotice()?.textContent).toContain(frozenNoticeCopy);
    expect(composerOf(container).disabled).toBe(true);
    expect(roundCalls(calls)).toHaveLength(1);
  });

  it("keeps the teacher's composer open in a frozen room", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/learning/chatroom?groupId=group-three");
    stubFetch({
      teachingCourses: () => teacherCoursesResponse([courseA]),
      chatroomHistory: () =>
        groupTranscriptResponse([], {}, { frozen: true }),
    });

    const { container } = renderChatroom(teacherUser);
    await settle();
    await settle();

    // A frozen room is quieted, not closed: the teacher who froze it still has
    // to be able to say why.
    expect(composerOf(container).disabled).toBe(false);
    expect(frozenNotice()).toBeNull();
    expect(freezeToggle()?.textContent).toContain(unfreezeCopy);
    expect(screen.getByText(frozenStateCopy)).toBeTruthy();
  });
});

describe("teacher chatroom moderation controls", () => {
  afterEach(resetChatroomHarness);

  it("renders no moderation controls for a member", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          { id: "stored-1", role: "student", content: "这条谁都能看。" },
        ]),
    });

    renderChatroom();
    await settle();
    await settle();

    expect(hideControlFor("stored-1")).toBeNull();
    expect(freezeToggle()).toBeNull();
  });

  it("hides one message through the moderation route and reports it", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/learning/chatroom?groupId=group-three");
    const { calls } = stubFetch({
      teachingCourses: () => teacherCoursesResponse([courseA]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          {
            id: "stored-bad",
            role: "student",
            content: "这条不该留在群里。",
            authorName: "林若晨",
            isSelf: false,
          },
        ]),
    });

    renderChatroom(teacherUser);
    await settle();
    await settle();
    expect(screen.getByText("这条不该留在群里。")).toBeTruthy();

    const hide = hideControlFor("stored-bad");
    expect(hide).toBeTruthy();
    expect(hide?.textContent).toContain(hideCopy);

    fireEvent.click(hide as HTMLButtonElement);
    await settle();
    await settle();

    const moderations = moderationCalls(calls);
    expect(moderations).toHaveLength(1);
    expect(moderations[0].method).toBe("POST");
    expect(moderations[0].body).toEqual({
      action: "hide-message",
      courseId: "course-a",
      classId: "class-a",
      groupId: "group-three",
      messageId: "stored-bad",
    });

    // The receipt is written only after the route accepts: moderation is the one
    // chatroom write that is not best-effort, so "hidden" must never be shown
    // for a message the class can still read.
    expect(moderationReceipt()?.textContent).toContain(hiddenReceiptCopy);
    expect(screen.queryByText("这条不该留在群里。")).toBeNull();
  });

  it("reports a refused hide instead of pretending it landed", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/learning/chatroom?groupId=group-three");
    stubFetch({
      teachingCourses: () => teacherCoursesResponse([courseA]),
      chatroomHistory: () =>
        groupTranscriptResponse([
          { id: "stored-bad", role: "student", content: "存储挂了。", isSelf: false },
        ]),
      moderation: () =>
        Response.json(
          { error: "storage unavailable", reasonCode: "moderation-storage-unavailable" },
          { status: 503 },
        ),
    });

    renderChatroom(teacherUser);
    await settle();
    await settle();

    fireEvent.click(hideControlFor("stored-bad") as HTMLButtonElement);
    await settle();
    await settle();

    expect(moderationReceipt()?.textContent).toContain("操作未生效，请稍后重试。");
    expect(screen.getByText("存储挂了。")).toBeTruthy();
  });

  it("freezes and unfreezes the room with a state label the teacher can read", async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/learning/chatroom?groupId=group-three");
    const { calls } = stubFetch({
      teachingCourses: () => teacherCoursesResponse([courseA]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    renderChatroom(teacherUser);
    await settle();
    await settle();

    const toggle = freezeToggle() as HTMLButtonElement;
    expect(toggle.textContent).toContain(freezeCopy);
    expect(toggle.dataset.uaisChatroomFreezeToggle).toBe("open");

    fireEvent.click(toggle);
    await settle();
    await settle();

    const moderations = moderationCalls(calls);
    expect(moderations).toHaveLength(1);
    expect(moderations[0].body).toEqual({
      action: "freeze-room",
      courseId: "course-a",
      classId: "class-a",
      groupId: "group-three",
    });
    // The button names the ACTION and the line under it names the STATE, so the
    // control cannot be read as saying the opposite of what it does.
    expect((freezeToggle() as HTMLButtonElement).textContent).toContain(unfreezeCopy);
    expect(screen.getByText(frozenStateCopy)).toBeTruthy();

    fireEvent.click(freezeToggle() as HTMLButtonElement);
    await settle();
    await settle();
    expect(moderationCalls(calls)[1].body).toEqual(
      expect.objectContaining({ action: "unfreeze-room" }),
    );
  });

  it("drops a row the room has stopped replaying, for every member", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: (_url, index) =>
        index === 0
          ? groupTranscriptResponse([
              { id: "stored-1", role: "student", content: "第一条。", isSelf: false },
              { id: "stored-2", role: "student", content: "第二条要被隐藏。", isSelf: false },
            ])
          : groupTranscriptResponse([
              { id: "stored-1", role: "student", content: "第一条。", isSelf: false },
            ]),
    });

    renderChatroom();
    await settle();
    await settle();
    expect(screen.getByText("第二条要被隐藏。")).toBeTruthy();

    await advancePoll();
    await settle();

    // The hidden row was this member's NEWEST message, which the merge used to
    // preserve as an unsent tail - so a teacher's moderation reached the store,
    // the export and the share page, and not the screen it was made for.
    expect(screen.queryByText("第二条要被隐藏。")).toBeNull();
    expect(screen.getByText("第一条。")).toBeTruthy();
  });
});

describe("learner chatroom resend intent", () => {
  afterEach(resetChatroomHarness);

  it("retries delivery without buying a second agent round", async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      chatroom: (index) =>
        index === 0
          ? Response.json({
              status: "cue-user",
              turns: [
                {
                  messageId: "agent-live-1",
                  agentId: "methods-consultant",
                  content: "先把变量定义写清楚。",
                },
              ],
              transcript: { status: "unavailable" },
              progress: [],
              orchestration: {},
            })
          : Response.json({
              status: "cue-user",
              turns: [],
              transcript: { status: "persisted", appendedMessageCount: 1, messageCount: 1 },
              agentRound: { status: "skipped", reason: "resend-intent" },
              progress: [],
              orchestration: {},
            }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "@方法顾问 变量怎么定？");

    const retry = undeliveredControl();
    expect(retry).toBeTruthy();

    fireEvent.click(retry as HTMLButtonElement);
    await settle();
    await settle();

    const posts = roundCalls(calls);
    expect(posts).toHaveLength(2);
    // The first send is an ordinary round; the retry is not. Without the marker
    // the route's gate would read the same "@方法顾问 …" last student message
    // and run - and bill - the round a second time for a question asked once.
    expect(posts[0].body?.intent).toBeUndefined();
    expect(posts[1].body?.intent).toBe("resend");
    const sentId = postedMessageIds(posts[0]).at(-1);
    expect(posts[1].body?.messageId).toBe(sentId);
    // The resent id is one of the student rows the request carries, which is
    // what the route requires of the marker.
    expect(postedMessageIds(posts[1])).toContain(sentId);

    // A delivery retry waits on no agent, so the room never claims one is
    // thinking - and the confirmed receipt clears the mark.
    expect(screen.queryByText(thinkingCopy)).toBeNull();
    expect(undeliveredControl()).toBeNull();
  });
});

describe("learner chatroom share expiry", () => {
  afterEach(resetChatroomHarness);

  it("shows when the minted link stops working", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      share: () =>
        Response.json(
          {
            share: {
              shareId: "share-expiry0000000000000000001",
              courseId: "course-a",
              groupId: "group-three",
              createdAt: "2026-08-08T14:00:00.000Z",
              expiresAt: "2026-08-22T14:00:00.000Z",
            },
            sharePath: "/share/share-expiry0000000000000000001",
            shareUrl: "https://uais.top/share/share-expiry0000000000000000001",
          },
          { status: 201 },
        ),
    });

    renderChatroom();
    await settle();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /生成分享链接|分享链接/ }));
    await settle();
    await settle();

    const expiry = shareExpiry();
    expect(expiry).toBeTruthy();
    // Absolute and in the reading locale: "expires in 14 days" is exactly the
    // phrasing that leaves the person who pasted the link guessing which day.
    expect(expiry?.textContent).toContain("链接有效期至");
    expect(expiry?.textContent).toContain(
      formatShareExpiry("2026-08-22T14:00:00.000Z", "zh-CN") as string,
    );
  });

  it("shows no expiry line before a link is minted", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    renderChatroom();
    await settle();
    await settle();

    expect(shareExpiry()).toBeNull();
  });
});

// E16/PKG-10: DELETE /api/learning/chatroom/share/[shareId] existed and was
// tested from the day it was written, and nothing in the product ever called it
// - a link, once copied, could only be waited out. These pin the control that
// now does.
describe("learner chatroom share revoke", () => {
  afterEach(resetChatroomHarness);

  const mintedShareId = "share-revoke000000000000000000001";

  function mintResponse() {
    return Response.json(
      {
        share: {
          shareId: mintedShareId,
          courseId: "course-a",
          groupId: "group-three",
          createdAt: "2026-08-08T14:00:00.000Z",
          expiresAt: "2026-08-22T14:00:00.000Z",
        },
        sharePath: `/share/${mintedShareId}`,
        shareUrl: `https://uais.top/share/${mintedShareId}`,
      },
      { status: 201 },
    );
  }

  function revokeControl() {
    return document.querySelector<HTMLButtonElement>(
      '[data-uais-chatroom-share-revoke="idle"]',
    );
  }

  function revokeConfirm() {
    return document.querySelector<HTMLButtonElement>(
      "[data-uais-chatroom-share-revoke-confirm]",
    );
  }

  function revokeCancel() {
    return document.querySelector<HTMLButtonElement>(
      "[data-uais-chatroom-share-revoke-cancel]",
    );
  }

  function revokeCalls(calls: FetchCall[]) {
    return calls.filter(
      (call) =>
        call.url.includes("/api/learning/chatroom/share/") && call.method === "DELETE",
    );
  }

  async function mintLink(options: StubOptions = {}) {
    const stub = stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      share: mintResponse,
      ...options,
    });
    renderChatroom();
    await settle();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /生成分享链接|分享链接/ }));
    await settle();
    await settle();
    return stub;
  }

  it("revokes the minted link through DELETE and reports it", async () => {
    vi.useFakeTimers();
    const { calls } = await mintLink();

    expect(shareExpiry()).toBeTruthy();
    // Armed first: revoking cannot be undone and the people holding the link
    // are not here to be asked.
    expect(revokeConfirm()).toBeNull();
    fireEvent.click(revokeControl() as HTMLButtonElement);
    expect(screen.getByText("撤销后，已复制这条链接的人将无法再打开。")).toBeTruthy();
    expect(revokeCalls(calls)).toHaveLength(0);

    fireEvent.click(revokeConfirm() as HTMLButtonElement);
    await settle();

    expect(revokeCalls(calls)).toHaveLength(1);
    expect(revokeCalls(calls)[0].url).toContain(
      `/api/learning/chatroom/share/${mintedShareId}`,
    );
    expect(screen.getByText("链接已撤销，之前复制的链接不再可用。")).toBeTruthy();
    // The withdrawn link stops being shown as a live one.
    expect(shareExpiry()).toBeNull();
    expect(revokeControl()).toBeNull();
  });

  it("keeps the link when the confirm is cancelled", async () => {
    vi.useFakeTimers();
    const { calls } = await mintLink();

    fireEvent.click(revokeControl() as HTMLButtonElement);
    fireEvent.click(revokeCancel() as HTMLButtonElement);
    await settle();

    expect(revokeCalls(calls)).toHaveLength(0);
    expect(shareExpiry()).toBeTruthy();
    expect(revokeControl()).toBeTruthy();
  });

  it("keeps showing a link the revoke could not withdraw", async () => {
    vi.useFakeTimers();
    const { calls } = await mintLink({
      shareRevoke: () => Response.json({ error: "store unavailable" }, { status: 503 }),
    });

    fireEvent.click(revokeControl() as HTMLButtonElement);
    fireEvent.click(revokeConfirm() as HTMLButtonElement);
    await settle();

    expect(revokeCalls(calls)).toHaveLength(1);
    expect(screen.getByText("撤销失败，请稍后再试。")).toBeTruthy();
    // The link is still live, so it is still shown as live: clearing it would
    // present a withdrawn link that still works.
    expect(shareExpiry()).toBeTruthy();
  });

  // The route answers 404 for an unknown id AND for a link already revoked or
  // expired, deliberately, so nobody can probe which links exist. In every one
  // of those the link is dead, which is what the caller asked for.
  it("treats a 404 as revoked rather than as a failure", async () => {
    vi.useFakeTimers();
    await mintLink({
      shareRevoke: () => Response.json({ error: "share not found" }, { status: 404 }),
    });

    fireEvent.click(revokeControl() as HTMLButtonElement);
    fireEvent.click(revokeConfirm() as HTMLButtonElement);
    await settle();

    expect(screen.getByText("链接已撤销，之前复制的链接不再可用。")).toBeTruthy();
    expect(shareExpiry()).toBeNull();
  });

  it("offers no revoke control before a link is minted", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    renderChatroom();
    await settle();
    await settle();

    expect(revokeControl()).toBeNull();
  });
});

// E12/PKG-7: the room on a 375px screen, and the auto-scroll guard behind its
// "jump to latest" affordance.
describe("learner chatroom narrow-viewport layout", () => {
  afterEach(resetChatroomHarness);

  it("puts the thread and its composer ahead of the roster below xl", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    renderChatroom();
    await settle();
    await settle();

    const zones = Array.from(
      document.querySelectorAll<HTMLElement>("[data-uais-chatroom-zone]"),
    ).map((zone) => zone.dataset.uaisChatroomZone);
    // DOM order is what a 375px single column renders top to bottom; the desktop
    // columns are restored with `xl:order-*`, which is why the roster may sit
    // last here and still be the left column at `xl`.
    expect(zones).toEqual(["room-header", "thread", "agent-dock", "roster"]);

    const thread = document.querySelector<HTMLElement>(
      '[data-uais-chatroom-zone="thread"]',
    );
    expect(thread?.className).toContain("order-1");
    expect(thread?.className).toContain("xl:order-2");
    expect(rosterPanel()?.className).toContain("order-3");
    expect(rosterPanel()?.className).toContain("xl:order-1");
    // The composer is inside the thread zone, so "thread first" carries it.
    expect(thread?.querySelector("form")).toBeTruthy();
  });

  it("collapses the roster into an expandable section below xl", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    renderChatroom();
    await settle();
    await settle();

    const toggle = screen.getByRole("button", { name: "展开成员与智能体" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className).toContain("xl:hidden");

    const rosterBody = rosterPanel()?.querySelector<HTMLElement>("ul")?.parentElement;
    expect(rosterBody?.className).toContain("hidden");
    expect(rosterBody?.className).toContain("xl:block");

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "收起成员与智能体" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      rosterPanel()?.querySelector<HTMLElement>("ul")?.parentElement?.className,
    ).not.toContain("hidden");
  });
});

// The guard itself is pure on purpose: jsdom reports every scroll metric as 0,
// so the decision cannot be observed through a rendered thread.
describe("chatroom thread auto-scroll guard", () => {
  it("treats only the end of the thread as near the bottom", () => {
    expect(
      isThreadNearBottom({ scrollHeight: 2000, scrollTop: 1900, clientHeight: 100 }),
    ).toBe(true);
    expect(
      isThreadNearBottom({ scrollHeight: 2000, scrollTop: 1830, clientHeight: 100 }),
    ).toBe(true);
    expect(
      isThreadNearBottom({ scrollHeight: 2000, scrollTop: 400, clientHeight: 100 }),
    ).toBe(false);
  });

  it("keeps pinning the newest turn for a reader who is already at the bottom", () => {
    expect(
      resolveThreadAutoScroll({
        nearBottom: true,
        latestMessageIsSelf: false,
        hasNewMessages: true,
      }),
    ).toEqual({ scrollToBottom: true, revealJumpToLatest: false });
  });

  it("leaves a scrolled-up reader in place and offers the jump instead", () => {
    expect(
      resolveThreadAutoScroll({
        nearBottom: false,
        latestMessageIsSelf: false,
        hasNewMessages: true,
      }),
    ).toEqual({ scrollToBottom: false, revealJumpToLatest: true });
  });

  it("does not offer the jump when nothing new arrived", () => {
    // A poll that delivers no message, or an agents-pending flip, must not put a
    // "jump to latest" chip on screen.
    expect(
      resolveThreadAutoScroll({
        nearBottom: false,
        latestMessageIsSelf: false,
        hasNewMessages: false,
      }),
    ).toEqual({ scrollToBottom: false, revealJumpToLatest: false });
  });

  it("always follows the reader's own message", () => {
    expect(
      resolveThreadAutoScroll({
        nearBottom: false,
        latestMessageIsSelf: true,
        hasNewMessages: true,
      }),
    ).toEqual({ scrollToBottom: true, revealJumpToLatest: false });
  });
});

describe("learner chatroom auth dead-ends", () => {
  afterEach(resetChatroomHarness);

  it("offers a /login handoff beside the composer's sign-in notice", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
      // The session this client still believes in has expired server-side.
      chatroom: () => Response.json({ error: "sign in" }, { status: 401 }),
    });

    const { container } = renderChatroom();
    await settle();
    await settle();
    await sendMessage(container, "@方法顾问 在吗？");

    expect(screen.getByText(/请先登录，再与智能体对话。/)).toBeTruthy();
    const signInLink = document.querySelector<HTMLAnchorElement>(
      '[data-uais-chatroom-sign-in-link="true"]',
    );
    expect(signInLink?.getAttribute("href")).toBe("/login?from=%2Flearning%2Fchatroom");
  });

  it("offers the same handoff beside the export sign-in notice", async () => {
    vi.useFakeTimers();
    stubFetch({
      teachingCourses: () => studentCoursesResponse([courseA], [groupThree]),
      chatroomHistory: () => groupTranscriptResponse([]),
    });

    // No session at all: export refuses before it opens the print view.
    render(
      <SessionUserProvider initialSessionUser={null}>
        <LearningChatroomPage />
      </SessionUserProvider>,
    );
    await settle();
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /导出文档/ }));

    expect(screen.getByText(/请先登录，再导出聊天记录。/)).toBeTruthy();
    expect(
      document
        .querySelector('[data-uais-chatroom-sign-in-link="true"]')
        ?.getAttribute("href"),
    ).toBe("/login?from=%2Flearning%2Fchatroom");
  });
});
