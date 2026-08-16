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
  // `expiresAt` is the ISO moment the route stamped on the record. It is
  // carried back rather than dropped because a share link is the one thing this
  // product hands to people outside it: whoever pastes it should be told when it
  // stops working, instead of finding out the day it does. Optional only so a
  // deployment answering without the field still mints a usable link.
  | { status: "created"; shareId: string; url: string; expiresAt?: string }
  | { status: "failed" };

export type LearningChatroomShareRevokeResult =
  | { status: "revoked" }
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
      share?: { shareId?: unknown; expiresAt?: unknown };
      sharePath?: unknown;
      shareUrl?: unknown;
    };
    const shareId = typeof body.share?.shareId === "string" ? body.share.shareId : "";
    if (!shareId) {
      return { status: "failed" };
    }
    const expiresAt =
      typeof body.share?.expiresAt === "string" && body.share.expiresAt
        ? body.share.expiresAt
        : undefined;

    // The caller's own origin wins over the server's echo: the link is about to
    // be pasted by this user, and the browser knows which host they are on
    // (proxy, preview deployment, custom domain) better than a forwarded header.
    const url = options.origin
      ? createLearningChatroomShareUrl(shareId, options.origin)
      : typeof body.shareUrl === "string" && body.shareUrl
        ? body.shareUrl
        : `/share/${encodeURIComponent(shareId)}`;

    return { status: "created", shareId, url, ...(expiresAt ? { expiresAt } : {}) };
  } catch {
    return { status: "failed" };
  }
}

// Withdraws a link this session minted. The route existed and was tested from
// the day it was written, and nothing in the product ever called it: a link,
// once copied, could only be waited out.
//
// 404 counts as revoked rather than failed. The route answers it for an unknown
// id AND for a link that is already revoked or already expired - deliberately,
// so nobody can probe which links exist - and in every one of those cases the
// link is dead, which is exactly the outcome the caller asked for. Reporting a
// failure there would tell the person the link is still live when it is not.
export async function revokeLearningChatroomShareLink(
  shareId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<LearningChatroomShareRevokeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!shareId) {
    return { status: "failed" };
  }
  try {
    const response = await fetchImpl(
      `${learningChatroomSharePath}/${encodeURIComponent(shareId)}`,
      { method: "DELETE" },
    );
    return response.ok || response.status === 404
      ? { status: "revoked" }
      : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
