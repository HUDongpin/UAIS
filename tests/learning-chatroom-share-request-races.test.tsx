import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLearningChatroom } from "@/components/pages/use-learning-chatroom";

const user = vi.hoisted(() => ({ account: "fixture-student", role: "student", displayName: "Fixture", department: "Fixture" }));
vi.mock("@/components/providers/session-user", () => ({ useSessionUser: () => user }));
vi.mock("@/components/providers/app-preferences", () => ({ useAppPreferences: () => ({ locale: "en-US" }) }));

const courses = [
  { courseId: "course-a", classId: "class-a", courseName: "Course A" },
  { courseId: "course-b", classId: "class-b", courseName: "Course B" },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function shareResponse(shareId: string) {
  return Response.json({ share: { shareId }, sharePath: `/share/${shareId}` }, { status: 201 });
}

function stubRequests(options: { share: () => Promise<Response> | Response; revoke?: () => Promise<Response> | Response }) {
  const mint = vi.fn(options.share);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/teaching/courses") {
      return Response.json({
        courses,
        classes: courses.map((course) => ({ ...course, className: course.classId })),
        memberships: courses.map((course) => ({ ...course, membershipStatus: "approved" })),
        learningGroups: [],
      });
    }
    if (url.startsWith("/api/learning/chatroom/share")) {
      return init?.method === "DELETE"
        ? options.revoke?.() ?? Response.json({ status: "revoked" })
        : mint();
    }
    return Response.json({ messages: [], transcript: { status: "loaded" } });
  }));
  return mint;
}

async function openRoom() {
  const hook = renderHook(() => useLearningChatroom());
  await waitFor(() => expect(hook.result.current.activeCourse?.courseId).toBe("course-a"));
  return hook;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/learning/chatroom?courseId=course-a");
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("chatroom share request races", () => {
  it("does not show a previous room's delayed share in the current room", async () => {
    const pending = deferred<Response>();
    stubRequests({ share: () => pending.promise });
    const { result } = await openRoom();
    let request!: Promise<void>;
    act(() => { request = result.current.handleShare(); });
    act(() => { result.current.selectCourse(courses[1]); });
    await act(async () => { pending.resolve(shareResponse("share-room-a")); await request; });

    expect(result.current.activeCourse?.courseId).toBe("course-b");
    expect(result.current.shareLink).toBeNull();
    expect(result.current.notice).not.toContain("share-room-a");
  });

  it("does not clear a new link when an older revocation finishes", async () => {
    const pending = deferred<Response>();
    let nextShare = 0;
    stubRequests({ share: () => shareResponse(`share-${++nextShare}`), revoke: () => pending.promise });
    const { result } = await openRoom();
    await act(async () => { await result.current.handleShare(); });
    let revoke!: Promise<void>;
    act(() => { revoke = result.current.confirmShareRevoke(); });
    await act(async () => { await result.current.handleShare(); });
    expect(result.current.shareLink?.shareId).toBe("share-2");
    await act(async () => { pending.resolve(Response.json({ status: "revoked" })); await revoke; });

    expect(result.current.shareLink?.shareId).toBe("share-2");
    expect(result.current.notice).not.toBe(result.current.t.learning.shareRevoked);
    expect(result.current.shareRevokePending).toBe(false);
  });

  it("does not let a previous room's revoke response clear its replacement", async () => {
    const pending = deferred<Response>();
    let nextShare = 0;
    stubRequests({ share: () => shareResponse(`share-${++nextShare}`), revoke: () => pending.promise });
    const { result } = await openRoom();
    await act(async () => { await result.current.handleShare(); });
    let revoke!: Promise<void>;
    act(() => { revoke = result.current.confirmShareRevoke(); });
    act(() => { result.current.selectCourse(courses[1]); });
    expect(result.current.shareRevokePending).toBe(false);
    await act(async () => { await result.current.handleShare(); });
    await act(async () => { pending.resolve(Response.json({ status: "revoked" })); await revoke; });

    expect(result.current.shareLink?.shareId).toBe("share-2");
    expect(result.current.notice).not.toBe(result.current.t.learning.shareRevoked);
  });

  it("coalesces repeated share clicks while a mint is pending", async () => {
    const pending = deferred<Response>();
    const mint = stubRequests({ share: () => pending.promise });
    const { result } = await openRoom();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.handleShare(); second = result.current.handleShare(); });
    await act(async () => { pending.resolve(shareResponse("share-one")); await Promise.all([first, second]); });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("retains the current revocable link if another mint fails", async () => {
    let calls = 0;
    stubRequests({ share: () => ++calls === 1 ? shareResponse("share-existing") : Response.json({}, { status: 503 }) });
    const { result } = await openRoom();
    await act(async () => { await result.current.handleShare(); });
    await act(async () => { await result.current.handleShare(); });
    expect(result.current.shareLink?.shareId).toBe("share-existing");
    expect(result.current.notice).toBe(result.current.t.learning.shareFailed);
  });

  it("ignores a clipboard completion after the learner switches rooms", async () => {
    const clipboard = deferred<void>();
    vi.stubGlobal("navigator", { clipboard: { writeText: () => clipboard.promise } });
    stubRequests({ share: () => shareResponse("share-room-a") });
    const { result } = await openRoom();
    let request!: Promise<void>;
    act(() => { request = result.current.handleShare(); });
    await waitFor(() => expect(result.current.shareLink?.shareId).toBe("share-room-a"));
    act(() => { result.current.selectCourse(courses[1]); });
    await act(async () => { clipboard.resolve(); await request; });
    expect(result.current.shareLink).toBeNull();
    expect(result.current.notice).not.toContain("share-room-a");
  });
});
