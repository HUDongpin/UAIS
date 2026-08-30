"use client";

// Wire layer for the human-AI group chatroom (S04). Every request/response shape
// the controller speaks lives here, together with the tolerant parsers that turn
// them into the room's own types. Nothing here holds React state, which is what
// keeps `use-learning-chatroom.ts` about room behaviour and under the source-file
// cap.
//
// Backend contract this mirrors (Phase 2, do not change):
// - GET /api/learning/chatroom/history?courseId=&classId=&groupId= replays one room and
//   adds a `transcript` receipt describing whether the store could be read.
// - POST /api/learning/chatroom answers the round AND reports, in the same 200,
//   whether the round was persisted.
// - Group discovery rides GET /api/teaching/courses (`learningGroups`).

import { aiAgents, type ChatMessage } from "@/data/uais";
import { copy, type Locale } from "@/i18n/copy";
import { publishedLearningPptCourseId } from "./learning-page-content";

export type ChatroomRoomMember = {
  displayName: string;
  isSelf: boolean;
};

// One usable chatroom course, joined from the student membership/course/class
// projections or taken from a teacher-owned course record.
export type ChatroomCourseOption = {
  courseId: string;
  classId?: string;
  courseName: string;
  className?: string;
  semester?: string;
};

// One assigned group the caller may enter, normalized from the student
// (`{displayName,isSelf}`) or teacher (`{studentId,studentDisplayName}`)
// projection of GET /api/teaching/courses.
export type ChatroomGroupOption = {
  groupId: string;
  courseId: string;
  classId?: string;
  groupName: string;
  members: ChatroomRoomMember[];
};

export type ActiveChatroomCourse = {
  courseId: string;
  classId?: string;
  courseName?: string;
  className?: string;
  semester?: string;
  isDemo: boolean;
  // Why the demo course is standing in for a real one: "no-courses" when the
  // signed-in fetch returned nothing usable, "load-failed" when the fetch
  // itself failed. Absent for a genuine demo context (signed out, demo hint).
  fallbackReason?: "no-courses" | "load-failed";
};

export type ChatroomCourseResolution =
  | { status: "pending" }
  | { status: "select"; options: ChatroomCourseOption[] }
  | { status: "ready"; course: ActiveChatroomCourse };

export const demoFallbackCourse: ActiveChatroomCourse = {
  courseId: publishedLearningPptCourseId,
  isDemo: true,
};

// Both GET and POST answer with a transcript receipt. `persisted` (POST) and
// `loaded` (GET) mean the room's store confirmed the operation; `unavailable`
// means it did not - a store outage, or an append the route abandoned when the
// serverless wall ran out. The route reports `unavailable` INSIDE a 200, because
// the round itself succeeded, so a client that reads only `response.ok` shows a
// message nobody else will ever receive as delivered.
type ChatroomTranscriptReceipt = {
  status?: unknown;
};

// `unavailable` is the only value read as "not confirmed". An absent, malformed
// or unknown receipt counts as confirmed on purpose: a deployment that answers
// without one must not paint every delivered message as failed.
export function isUnconfirmedTranscriptReceipt(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (value as ChatroomTranscriptReceipt).status === "unavailable";
}

// POST /api/learning/chatroom response contract.
type ChatroomTurn = {
  // The id the room stored this turn under. Reused as the rendered message id so
  // the next round re-posts it and the server append stays idempotent.
  messageId?: string;
  agentId?: string;
  content?: string;
};

export type ChatroomApiResponse = {
  status?: "cue-user" | "end" | "max-turns";
  turns?: ChatroomTurn[];
  // Per-agent mid-round failures; the matching fallback turns already carry
  // server-localized copy, so the UI renders nothing extra for these.
  turnErrors?: Array<{ agentId?: string; kind?: "timeout" | "provider" }>;
  // Whether the round reached the room's store. Read through
  // `isUnconfirmedTranscriptReceipt`, never by status code.
  transcript?: unknown;
  error?: string;
};

export function toAgentChatMessage(
  turn: ChatroomTurn,
  index: number,
  stamp: number,
  locale: Locale,
): ChatMessage {
  const agent = aiAgents.find((candidate) => candidate.id === turn.agentId);
  const content = typeof turn.content === "string" ? turn.content : "";

  return {
    id: turn.messageId ?? `agent-${stamp}-${index}`,
    kind: "agent",
    // Off-roster agent ids still render, under a generic AI label.
    author: agent?.name ?? {
      "zh-CN": "智能体",
      "en-US": "AI Agent",
    },
    agentHandle: agent?.handle,
    text: {
      "zh-CN": content,
      "en-US": content,
    },
    time: locale === "zh-CN" ? "刚刚" : "Now",
  };
}

// Ids have to stay unique across sessions, because the server keys transcript
// appends by message id: a counter that restarted at 1 after a reload would make
// a fresh message look like one the room had already stored, and it would be
// silently dropped. The same property is what makes tap-to-retry safe: a retry
// re-posts the id it was minted with, so the append cannot double-post it.
let localChatMessageSequence = 0;

export function createLocalChatMessageId() {
  localChatMessageSequence += 1;
  const unique =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `local-${unique}-${localChatMessageSequence}`;
}

// GET /api/learning/chatroom/history response contract: the room's stored transcript,
// plus the group roster for a group room.
type ChatroomHistoryMessage = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  agentId?: unknown;
  authorName?: unknown;
  authorRole?: unknown;
  isSelf?: unknown;
  createdAt?: unknown;
};

type ChatroomHistoryResponse = {
  groupId?: unknown;
  groupName?: unknown;
  members?: unknown;
  messages?: unknown;
  transcript?: unknown;
  // Always a definite status from the route (`open` when a room was never
  // moderated), so the client never has to infer "open" from a missing key.
  moderation?: unknown;
};

export type ChatroomHistoryResult =
  | {
      status: "loaded";
      messages: ChatMessage[];
      // The read succeeded as a request but the store did not answer, so
      // `messages` is empty because nothing could be read - not because the room
      // is empty. The caller keeps the thread it already shows and says so.
      transcriptUnavailable: boolean;
      // The course teacher has frozen this room: it still reads, it just stops
      // taking student posts. Read from the room state rather than only from a
      // refused send, so a member who has not typed yet is told before they do.
      roomFrozen: boolean;
      // The room is holding a full rolling window, so older turns are leaving
      // it - and leaving the export and the share link with it.
      transcriptWindowAtCapacity: boolean;
      groupId?: string;
      groupName?: string;
      members?: ChatroomRoomMember[];
    }
  // 403 `feature-not-enabled`: this deployment has not turned group rooms on, so
  // the client drops the group and keeps the legacy per-student room silently.
  | { status: "groups-disabled" }
  | { status: "denied"; reasonCode?: string }
  | { status: "throttled"; retryAfterSeconds?: number }
  | { status: "failed" };

// Never throws and never reports "no history" for a transport problem: the
// caller keeps whatever the room already shows, which is what makes a 429 or a
// blip harmless while polling.
export async function fetchChatroomHistory(input: {
  courseId: string;
  classId?: string;
  groupId?: string;
  locale: Locale;
  otherMemberFallbackName: string;
}): Promise<ChatroomHistoryResult> {
  const query = new URLSearchParams({ courseId: input.courseId });
  if (input.classId) {
    query.set("classId", input.classId);
  }
  if (input.groupId) {
    query.set("groupId", input.groupId);
  }

  try {
    const response = await fetch(`/api/learning/chatroom/history?${query.toString()}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 429) {
      return {
        status: "throttled",
        ...readRetryAfterSeconds(response),
      };
    }
    if (response.status === 403) {
      const reasonCode = await readAccessReasonCode(response);
      if (reasonCode === "feature-not-enabled") {
        return { status: "groups-disabled" };
      }
      return { status: "denied", ...(reasonCode ? { reasonCode } : {}) };
    }
    if (!response.ok) {
      return { status: "failed" };
    }

    const body = (await response.json()) as ChatroomHistoryResponse;
    if (!Array.isArray(body?.messages)) {
      return { status: "failed" };
    }

    const groupId = readString(body.groupId);
    const isGroupRoom = Boolean(groupId);
    return {
      status: "loaded",
      transcriptUnavailable: isUnconfirmedTranscriptReceipt(body.transcript),
      roomFrozen: isFrozenRoomModeration(body.moderation),
      transcriptWindowAtCapacity: isTranscriptWindowAtCapacity(body.transcript),
      messages: body.messages.flatMap((message) => {
        const restored = toStoredChatMessage(
          message as ChatroomHistoryMessage,
          input.locale,
          { isGroupRoom, otherMemberFallbackName: input.otherMemberFallbackName },
        );
        return restored ? [restored] : [];
      }),
      ...(groupId ? { groupId } : {}),
      ...(readString(body.groupName) ? { groupName: readString(body.groupName) } : {}),
      ...(Array.isArray(body.members)
        ? { members: readRoomMembers(body.members) }
        : {}),
    };
  } catch {
    return { status: "failed" };
  }
}

// Only an explicit `frozen` closes the composer. An absent or malformed block
// reads as open on purpose: a deployment that answers without moderation state
// must not mute every room it serves.
function isFrozenRoomModeration(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (value as { status?: unknown }).status === "frozen";
}

// Same tolerance in the other direction: the disclosure is claimed only when the
// route actually says the window is full, never inferred from a message count
// the client happens to be holding.
function isTranscriptWindowAtCapacity(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const window = (value as { window?: unknown }).window;
  if (typeof window !== "object" || window === null) {
    return false;
  }
  return (window as { atCapacity?: unknown }).atCapacity === true;
}

export function readRetryAfterSeconds(response: Response) {
  const header = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  return Number.isFinite(header) && header > 0 ? { retryAfterSeconds: header } : {};
}

async function readAccessReasonCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { access?: { reasonCode?: unknown } };
    return readString(body?.access?.reasonCode);
  } catch {
    return undefined;
  }
}

// The top-level `reasonCode` a refusal carries beside its prose - the stable
// classification a client has to ACT on rather than merely display.
async function readRefusalReasonCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { reasonCode?: unknown };
    return readString(body?.reasonCode);
  } catch {
    return undefined;
  }
}

// A frozen room answers 423 with `reasonCode: "chatroom-room-frozen"`. This is
// the one send refusal the composer must CLOSE for instead of offering a retry,
// so it is read from the reason code rather than guessed from the status alone.
// An unreadable body still counts: 423 means the room is locked either way, and
// leaving the composer open would only invite a second refusal.
export async function isFrozenChatroomRefusal(response: Response): Promise<boolean> {
  if (response.status !== 423) {
    return false;
  }
  const reasonCode = await readRefusalReasonCode(response);
  return reasonCode === undefined || reasonCode === "chatroom-room-frozen";
}

export type ChatroomModerationAction =
  | "hide-message"
  | "restore-message"
  | "freeze-room"
  | "unfreeze-room";

export type ChatroomModerationResult = { status: "applied" } | { status: "failed" };

// Teacher moderation for the open room. Every non-2xx collapses to `failed`:
// the moderator gets one honest "that did not go through" rather than a reason
// code in the UI, and - because moderation is the one chatroom write that is not
// best-effort - a failure is never reported as success.
export async function requestLearningChatroomModeration(input: {
  action: ChatroomModerationAction;
  courseId: string;
  classId?: string;
  groupId?: string;
  messageId?: string;
}): Promise<ChatroomModerationResult> {
  try {
    const response = await fetch("/api/learning/chatroom/moderation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: input.action,
        courseId: input.courseId,
        ...(input.classId ? { classId: input.classId } : {}),
        ...(input.groupId ? { groupId: input.groupId } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
      }),
    });
    return response.ok ? { status: "applied" } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

function readRoomMembers(value: unknown[]): ChatroomRoomMember[] {
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const displayName = readString(record.displayName);
    if (!displayName) {
      return [];
    }
    return [{ displayName, isSelf: record.isSelf === true }];
  });
}

function toStoredChatMessage(
  message: ChatroomHistoryMessage,
  locale: Locale,
  room: { isGroupRoom: boolean; otherMemberFallbackName: string },
): ChatMessage | undefined {
  const id = readString(message.id);
  const content = readString(message.content);
  if (!id || !content || (message.role !== "student" && message.role !== "agent")) {
    return undefined;
  }

  const time = formatStoredChatMessageTime(message.createdAt, locale);
  if (message.role === "student") {
    // Group rooms have several writers, so "is this mine?" is decided by the
    // server-computed `isSelf` and never by the row simply being a student row.
    // A legacy room is scoped to one account, so every stored student message
    // there is the current viewer's own.
    if (!room.isGroupRoom) {
      return {
        id,
        kind: "student",
        author: { "zh-CN": "我", "en-US": "Me" },
        text: { "zh-CN": content, "en-US": content },
        time,
        self: true,
      };
    }

    const isSelf = message.isSelf === true;
    // Absent on pre-v2 rows, so an older group transcript still renders with a
    // neutral label instead of being attributed to whoever is reading.
    const authorName = readString(message.authorName);
    return {
      id,
      kind: "student",
      author: isSelf
        ? { "zh-CN": "我", "en-US": "Me" }
        : {
            "zh-CN": authorName ?? room.otherMemberFallbackName,
            "en-US": authorName ?? room.otherMemberFallbackName,
          },
      text: { "zh-CN": content, "en-US": content },
      time,
      self: isSelf,
      // Only the server marks a turn as the teacher's; the client never infers
      // it from the reader's own role.
      ...(message.authorRole === "teacher" ? { instructor: true } : {}),
    };
  }

  const agent = aiAgents.find((candidate) => candidate.id === message.agentId);
  return {
    id,
    kind: "agent",
    // Off-roster agent ids still render, under a generic AI label.
    author: agent?.name ?? { "zh-CN": "智能体", "en-US": "AI Agent" },
    agentHandle: agent?.handle,
    text: { "zh-CN": content, "en-US": content },
    time,
  };
}

function formatStoredChatMessageTime(createdAt: unknown, locale: Locale) {
  const storedAt = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
  if (Number.isNaN(storedAt)) {
    return locale === "zh-CN" ? "早前" : "Earlier";
  }
  return new Date(storedAt).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function resolveAgentErrorCopy(
  status: number,
  t: (typeof copy)[Locale],
  retryAfterSeconds?: number,
): string {
  if (status === 400) {
    return t.learning.agentRequestInvalid;
  }
  if (status === 401) {
    return t.learning.agentSignInRequired;
  }
  if (status === 403) {
    return t.learning.agentAccessDenied;
  }
  // A 429 is the sender's own send rate, not an outage. Falling through to
  // agentUnavailable told the student "the AI service is temporarily
  // unavailable" - which is untrue, unactionable, and (since the server had
  // already declined to store the message) hid that the message was never
  // delivered. The GET path has always read Retry-After; this is the same
  // treatment for POST.
  if (status === 429) {
    return retryAfterSeconds && retryAfterSeconds > 0
      ? t.learning.agentRateLimited.replace("{seconds}", String(retryAfterSeconds))
      : t.learning.agentRateLimitedShortly;
  }
  // A frozen room is a deliberate teaching decision, not an outage: saying "the
  // AI service is unavailable" would blame the wrong thing and imply a retry
  // that the room will refuse for exactly as long as the teacher intends.
  if (status === 423) {
    return t.learning.chatroomFrozenNotice;
  }
  return t.learning.agentUnavailable;
}

// GET /api/teaching/courses is parsed tolerantly: unknown fields are ignored.
// A non-OK/malformed/network answer is reported as a failure rather than as an
// empty roster, so the UI never claims the learner has no courses.
type TeachingCoursesResponseBody = {
  courses?: unknown;
  classes?: unknown;
  memberships?: unknown;
  learningGroups?: unknown;
};

export type ChatroomCourseFetchResult =
  | { ok: true; options: ChatroomCourseOption[]; groups: ChatroomGroupOption[] }
  | { ok: false };

export async function fetchUsableChatroomCourses(
  role: string,
): Promise<ChatroomCourseFetchResult> {
  try {
    const response = await fetch("/api/teaching/courses", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false };
    }
    const body = (await response.json()) as TeachingCoursesResponseBody;
    // A 200 whose body parses but carries the wrong shape is a failed load, not
    // an empty roster: reporting it as "no courses" would tell an enrolled
    // learner to go join a course. A well-formed empty array stays genuine.
    if (role === "student") {
      if (!Array.isArray(body?.memberships)) {
        return { ok: false };
      }
      return {
        ok: true,
        options: readStudentCourseOptions(body),
        groups: readChatroomGroups(body.learningGroups),
      };
    }
    if (!Array.isArray(body?.courses)) {
      return { ok: false };
    }
    return {
      ok: true,
      options: readTeacherCourseOptions(body),
      groups: readChatroomGroups(body.learningGroups),
    };
  } catch {
    return { ok: false };
  }
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null,
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

// Students receive `{displayName,isSelf}` co-member rows for their own groups;
// teachers receive the full records (`{studentId,studentDisplayName}`) for the
// courses they own. Both normalize to the same roster shape, and neither is ever
// asked for an account id.
function readChatroomGroups(value: unknown): ChatroomGroupOption[] {
  return asRecordArray(value).flatMap((group) => {
    const groupId = readString(group.groupId);
    const courseId = readString(group.courseId);
    const groupName = readString(group.groupName);
    if (!groupId || !courseId || !groupName) {
      return [];
    }
    const members = asRecordArray(group.members).flatMap((member) => {
      const displayName =
        readString(member.displayName) ?? readString(member.studentDisplayName);
      if (!displayName) {
        return [];
      }
      return [{ displayName, isSelf: member.isSelf === true }];
    });
    const classId = readString(group.classId);
    return [
      {
        groupId,
        courseId,
        ...(classId ? { classId } : {}),
        groupName,
        members,
      },
    ];
  });
}

// Student view: usable courses are approved memberships joined to the
// student-visible course/class projections for display names.
function readStudentCourseOptions(
  body: TeachingCoursesResponseBody,
): ChatroomCourseOption[] {
  const courses = asRecordArray(body.courses);
  const classes = asRecordArray(body.classes);
  const options: ChatroomCourseOption[] = [];
  for (const membership of asRecordArray(body.memberships)) {
    if (membership.membershipStatus !== "approved") {
      continue;
    }
    const courseId = readString(membership.courseId);
    if (!courseId) {
      continue;
    }
    const classId = readString(membership.classId);
    const course = courses.find((entry) => entry.courseId === courseId);
    const classItem = classes.find(
      (entry) => entry.classId === classId && entry.courseId === courseId,
    );
    options.push({
      courseId,
      classId,
      courseName: readString(course?.courseName) ?? courseId,
      className: readString(classItem?.className),
      semester: readString(classItem?.semester) ?? readString(course?.semester),
    });
  }
  return dedupeCourseOptions(options);
}

// Teacher view: usable courses are all owned course records.
function readTeacherCourseOptions(
  body: TeachingCoursesResponseBody,
): ChatroomCourseOption[] {
  const options = asRecordArray(body.courses).flatMap((course) => {
    const courseId = readString(course.courseId);
    const courseName = readString(course.courseName);
    if (!courseId || !courseName) {
      return [];
    }
    return [{ courseId, courseName, semester: readString(course.semester) }];
  });
  return dedupeCourseOptions(options);
}

function dedupeCourseOptions(
  options: ChatroomCourseOption[],
): ChatroomCourseOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.courseId}::${option.classId ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Resolution priority: URL hint → single usable course → picker for multiple →
// demo fallback (announced with the reason it stood in). A `?groupId=` deep link
// is resolved before this runs, because the group record already names its own
// course.
export function resolveChatroomCourse(
  result: ChatroomCourseFetchResult,
  hints: {
    urlCourseId: string | null;
    urlClassId: string | null;
  },
): ChatroomCourseResolution {
  if (!result.ok) {
    return {
      status: "ready",
      course: { ...demoFallbackCourse, fallbackReason: "load-failed" },
    };
  }

  const options = result.options;
  const matchHint = (courseId: string | null, classId: string | null) => {
    if (!courseId) {
      return undefined;
    }
    const sameCourse = options.filter((option) => option.courseId === courseId);
    if (!classId) {
      return sameCourse[0];
    }
    return (
      sameCourse.find((option) => option.classId === classId) ??
      // Teacher options carry no classId, so a class-scoped deep link must
      // still resolve to the course instead of being discarded.
      sameCourse.find((option) => !option.classId)
    );
  };

  const hinted = matchHint(hints.urlCourseId, hints.urlClassId);
  if (hinted) {
    return { status: "ready", course: { ...hinted, isDemo: false } };
  }
  if (options.length === 1) {
    return { status: "ready", course: { ...options[0], isDemo: false } };
  }
  if (options.length > 1) {
    return { status: "select", options };
  }
  return {
    status: "ready",
    course: { ...demoFallbackCourse, fallbackReason: "no-courses" },
  };
}
