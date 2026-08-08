// Chatroom export/share helpers (S04). Phase 5 replaced the two mocks that used
// to live here - `exportChatToPdf` returned `{status:"mocked"}` and
// `createShareLink` hard-coded `/share/research-method-group` - with the two real
// calls behind the room header's buttons:
//
// - Export opens `/learning/chatroom/export`, the print view. There is no PDF
//   service and no credential: the browser's print dialog is the generator.
// - Share mints a real, revocable share record through
//   `POST /api/learning/chatroom/share` and returns the absolute link to copy.
//
// Both are plain functions rather than hook internals so the wiring stays
// testable without rendering the room.

export type LearningChatroomRoomQuery = {
  courseId: string;
  classId?: string;
  groupId?: string;
};

export type LearningChatroomShareLinkResult =
  | { status: "created"; shareId: string; url: string }
  | { status: "failed" };

export const learningChatroomExportPath = "/learning/chatroom/export";
export const learningChatroomSharePath = "/api/learning/chatroom/share";

// The print view resolves the same room the chatroom is showing, so the room key
// travels in the query string exactly as it does on the chatroom GET.
export function createLearningChatroomExportUrl(room: LearningChatroomRoomQuery) {
  const params = new URLSearchParams({ courseId: room.courseId });
  if (room.classId) {
    params.set("classId", room.classId);
  }
  if (room.groupId) {
    params.set("groupId", room.groupId);
  }
  return `${learningChatroomExportPath}?${params.toString()}`;
}

export function createLearningChatroomShareUrl(shareId: string, origin: string) {
  return `${origin.replace(/\/$/, "")}/share/${encodeURIComponent(shareId)}`;
}

// Mint is a real, authorized write: the server decides whether this caller may
// publish this room, so every non-2xx answer collapses to `failed` here and the
// room shows one copy string rather than leaking a reason code into the UI.
export async function requestLearningChatroomShareLink(
  room: LearningChatroomRoomQuery,
  options: { origin: string; fetchImpl?: typeof fetch } = { origin: "" },
): Promise<LearningChatroomShareLinkResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(learningChatroomSharePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId: room.courseId,
        ...(room.classId ? { classId: room.classId } : {}),
        ...(room.groupId ? { groupId: room.groupId } : {}),
      }),
    });
    if (!response.ok) {
      return { status: "failed" };
    }

    const body = (await response.json()) as {
      share?: { shareId?: unknown };
      sharePath?: unknown;
      shareUrl?: unknown;
    };
    const shareId = typeof body.share?.shareId === "string" ? body.share.shareId : "";
    if (!shareId) {
      return { status: "failed" };
    }

    // The caller's own origin wins over the server's echo: the link is about to
    // be pasted by this user, and the browser knows which host they are on
    // (proxy, preview deployment, custom domain) better than a forwarded header.
    const url = options.origin
      ? createLearningChatroomShareUrl(shareId, options.origin)
      : typeof body.shareUrl === "string" && body.shareUrl
        ? body.shareUrl
        : `/share/${encodeURIComponent(shareId)}`;

    return { status: "created", shareId, url };
  } catch {
    return { status: "failed" };
  }
}
