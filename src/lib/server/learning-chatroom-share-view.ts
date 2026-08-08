import { aiAgents } from "@/data/uais";
import { copy, type Locale } from "@/i18n/copy";
import type { AiRequestRateLimiter } from "@/lib/server/ai-request-rate-limit";
import {
  createLearningChatroomShareReadRateLimiter,
  isLearningChatroomShareUnknownViewerKey,
  learningChatroomShareViewerUnknownKey,
} from "@/lib/server/learning-chatroom-share-rate-limit";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  readTeachingCourseManagementSnapshot,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementDatabase,
  type TeachingCourseManagementRepository,
} from "@/lib/server/teaching-course-management-store";
import {
  authorizeLearningAiGuideCourseAccess,
  type LearningAiGuideCourseAccessDecision,
} from "@/lib/server/learning-ai-guide-access";
import { isLearningChatroomGroupsEnabled } from "@/lib/server/learning-chatroom-groups-flag";
import { resolveLearningChatroomShareBackend } from "@/lib/server/learning-chatroom-share-runtime";
import {
  isLearningChatroomShareActive,
  readLearningChatroomShare,
  type LearningChatroomShareRecord,
  type LearningChatroomShareRepository,
} from "@/lib/server/learning-chatroom-share-store";
import { readLearningChatroomHistory } from "@/lib/server/learning-chatroom-transcript-runtime";
import type { LearningChatroomTranscriptMessage } from "@/lib/server/learning-chatroom-transcript-store";
import type { LearningChatroomTranscriptRepository } from "@/lib/server/learning-chatroom-transcript-store";

// Read models for the two Phase 5 transcript documents: the public
// `/share/[shareId]` page and the signed-in `/learning/chatroom/export` print
// view. Both are loaders rather than page bodies so the pages stay thin (params,
// cookies, `notFound()`) and every authorization/projection rule is testable
// through injected env, repositories and clocks.
//
// One rule governs both: a document carries DISPLAY NAMES ONLY. Student account
// ids are the room's authorization key - they decide who may open it and who may
// revoke a share - so `authorId`, `createdBy` and `studentId` never reach a
// projection, exactly as in the chatroom GET.
//
// The share page renders the room LIVE at request time (owner decision): the
// share record is a capability naming a room, not a frozen copy, so revoking
// really stops the page and an active room keeps the link current.

export type ChatroomTranscriptDocumentMessage = {
  id: string;
  role: "student" | "agent";
  content: string;
  // Already resolved for rendering: a member's display-name snapshot, the
  // localized agent name, or the generic learner label when a v1 row carries no
  // attribution at all.
  authorLabel: string;
  agentId?: string;
  createdAt: string;
  timeLabel: string;
};

export type ChatroomTranscriptDocument = {
  locale: Locale;
  courseName?: string;
  groupName?: string;
  memberNames: string[];
  messages: ChatroomTranscriptDocumentMessage[];
  messageCount: number;
  dateRange?: { startLabel: string; endLabel: string };
  transcriptStatus: "loaded" | "unavailable";
};

export type LearningChatroomShareViewResult =
  | { status: "not-found" }
  | { status: "unavailable" }
  // Per-viewer throttle tripped before any storage read. `retryAfterSeconds` is
  // whole seconds and always >= 1, so a caller that can set headers may forward
  // it as `Retry-After`.
  | { status: "rate-limited"; retryAfterSeconds: number }
  | { status: "ready"; document: ChatroomTranscriptDocument };

export type LearningChatroomExportViewResult =
  | { status: "sign-in-required" }
  | { status: "denied"; reasonCode: string }
  | { status: "unavailable" }
  | { status: "ready"; document: ChatroomTranscriptDocument };

type ChatroomTranscriptViewDeps = {
  env: Record<string, string | undefined>;
  locale: Locale;
  fetch?: typeof fetch;
  shareRepository?: LearningChatroomShareRepository;
  transcriptRepository?: LearningChatroomTranscriptRepository;
  courseRepository?: TeachingCourseManagementRepository;
};

// One limiter per process (per serverless instance), constructed once at module
// load - exactly like the route handlers' module-level `POST`/`GET`. Tests inject
// their own via `rateLimiter` to get isolated counts and a fixed clock.
const sharedLearningChatroomShareReadRateLimiter =
  createLearningChatroomShareReadRateLimiter();

export async function loadLearningChatroomShareDocument(
  input: ChatroomTranscriptViewDeps & {
    shareId: string;
    // The per-viewer throttle key - the client IP for this signed-out page,
    // resolved by the page from request headers. Absent means the shared
    // unknown-viewer bucket, which throttles rather than bypasses.
    clientKey?: string;
    // Injected in tests for isolated counts and a fixed clock; production uses
    // the module singleton and the wall clock.
    rateLimiter?: AiRequestRateLimiter;
    nowMs?: number;
  },
): Promise<LearningChatroomShareViewResult> {
  // Throttle FIRST, before any storage read: an abusive or link-guessing viewer
  // must cost neither the shares-database read below nor the course-management
  // and transcript reads that follow it. This is the whole point of the guard -
  // it bounds the unbounded, uncached reads this signed-out page would otherwise
  // perform on every request.
  const rateLimiter =
    input.rateLimiter ?? sharedLearningChatroomShareReadRateLimiter;
  const clientKey = input.clientKey ?? learningChatroomShareViewerUnknownKey;
  const rateLimit = rateLimiter.check({
    key: clientKey,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (!rateLimit.allowed) {
    logLearningChatroomShareThrottle({
      windowId: rateLimit.windowId,
      limit: rateLimit.limit,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      // Which bucket, never which viewer - see the logger.
      keyKind: isLearningChatroomShareUnknownViewerKey(clientKey) ? "unknown" : "viewer-ip",
    });
    return { status: "rate-limited", retryAfterSeconds: rateLimit.retryAfterSeconds };
  }

  let share: LearningChatroomShareRecord | undefined;
  try {
    const shareBackend = resolveLearningChatroomShareBackend({
      env: input.env,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(input.shareRepository ? { repository: input.shareRepository } : {}),
    });
    share = await readLearningChatroomShare({
      dataDir: shareBackend.dataDir,
      env: input.env,
      ...(shareBackend.repository ? { repository: shareBackend.repository } : {}),
      shareId: input.shareId,
    });
  } catch {
    // A storage outage is not a revocation: it answers "temporarily
    // unavailable" rather than turning every live link into a 404.
    return { status: "unavailable" };
  }

  // Unknown and revoked are deliberately the same answer: whoever holds a link
  // must not be able to tell a wrong id from a withdrawn one.
  if (!isLearningChatroomShareActive(share)) {
    return { status: "not-found" };
  }

  // D9 kill switch: a group share discloses a live group room to a signed-out
  // viewer, so when group rooms are turned off (the documented incident
  // rollback) the share resolves exactly like every other group surface does -
  // a single indistinguishable not-found - even though the record still exists.
  // Legacy per-student shares (no groupId) are unaffected.
  if (share.groupId && !isLearningChatroomGroupsEnabled(input.env)) {
    return { status: "not-found" };
  }

  const snapshot = await readChatroomCourseDatabase(input);
  if (snapshot.status === "unavailable") {
    return { status: "unavailable" };
  }

  const group = share.groupId
    ? snapshot.database?.learningGroups?.find(
        (item) => item.groupId === share.groupId && item.courseId === share.courseId,
      )
    : undefined;
  // A deleted group orphans its room (plan P1), so its share links stop working
  // too - the link cannot outlive the group it points at.
  if (share.groupId && !group) {
    return { status: "not-found" };
  }

  const history = await readLearningChatroomHistory({
    env: input.env,
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.transcriptRepository ? { repository: input.transcriptRepository } : {}),
    courseId: share.courseId,
    ...(group?.classId ?? share.classId
      ? { classId: group?.classId ?? share.classId }
      : {}),
    ...(share.groupId ? { groupId: share.groupId } : {}),
    studentId: share.createdBy,
  });

  const creatorDisplayName = readStudentDisplayName(snapshot.database, {
    courseId: share.courseId,
    studentId: share.createdBy,
  });

  return {
    status: "ready",
    document: createChatroomTranscriptDocument({
      locale: input.locale,
      courseName: readCourseName(snapshot.database, share.courseId),
      groupName: group?.groupName,
      memberNames: group
        ? group.members.map((member) => member.studentDisplayName)
        : creatorDisplayName
          ? [creatorDisplayName]
          : [],
      // A group room stamps every student row with its author; a legacy room has
      // exactly one possible author, so the creator's display name labels them.
      fallbackStudentName: group ? undefined : creatorDisplayName,
      messages: history.messages,
      transcriptStatus: history.status,
    }),
  };
}

// A throttle is an expected, healthy outcome, so it logs at warn and - like the
// chatroom route's throttle line - deliberately does not raise a Sentry event: a
// client retrying in a loop must not flood the error budget.
//
// The viewer's IP is NOT logged. It is unnecessary for the two questions an
// operator actually has, and a public read path would otherwise write a visitor
// log of who read which shared transcript. `keyKind` answers both: "viewer-ip"
// means ordinary per-viewer shedding, while a run of "unknown" means the edge is
// setting neither forwarded header, so every viewer worldwide is sharing one
// bucket - a misconfiguration that presents as a total share outage.
function logLearningChatroomShareThrottle(input: {
  windowId: string;
  limit: number;
  retryAfterSeconds: number;
  keyKind: "viewer-ip" | "unknown";
}) {
  console.warn("[learning-chatroom-share-view]", {
    phase: "rate-limit",
    keyKind: input.keyKind,
    rateLimit: {
      windowId: input.windowId,
      limit: input.limit,
      retryAfterSeconds: input.retryAfterSeconds,
    },
    message: "Public learning chatroom share read was throttled.",
  });
}

export async function loadLearningChatroomExportDocument(
  input: ChatroomTranscriptViewDeps & {
    appSession: { account: string; displayName: string; role: "teacher" | "student" | "admin" } | null;
    courseId?: string;
    classId?: string;
    groupId?: string;
  },
): Promise<LearningChatroomExportViewResult> {
  if (!input.appSession) {
    return { status: "sign-in-required" };
  }
  if (!input.courseId) {
    return { status: "denied", reasonCode: "course-context-required" };
  }
  // Same gate the chatroom GET applies, in the same order: the flag is checked
  // before authorization so a deployment with group rooms off answers the same
  // way whether or not the caller would have been a member.
  if (input.groupId && !isLearningChatroomGroupsModeEnabled(input.env)) {
    return { status: "denied", reasonCode: "feature-not-enabled" };
  }

  let access: LearningAiGuideCourseAccessDecision;
  try {
    access = await authorizeLearningAiGuideCourseAccess({
      appSession: { account: input.appSession.account, role: input.appSession.role },
      env: input.env,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(input.courseRepository ? { repository: input.courseRepository } : {}),
      courseId: input.courseId,
      ...(input.groupId ? { groupId: input.groupId } : {}),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (access.status === "denied") {
    return { status: "denied", reasonCode: access.reasonCode };
  }

  const group = access.group;
  const classId = group ? group.classId : input.classId;
  const history = await readLearningChatroomHistory({
    env: input.env,
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.transcriptRepository ? { repository: input.transcriptRepository } : {}),
    courseId: input.courseId,
    ...(classId ? { classId } : {}),
    ...(group ? { groupId: group.groupId } : {}),
    studentId: input.appSession.account,
  });

  const snapshot = await readChatroomCourseDatabase(input);

  return {
    status: "ready",
    document: createChatroomTranscriptDocument({
      locale: input.locale,
      courseName: readCourseName(snapshot.database, input.courseId),
      groupName: group?.groupName,
      memberNames: group?.members.map((member) => member.displayName) ?? [],
      // A legacy room belongs to the caller, so its unattributed student rows
      // are theirs.
      fallbackStudentName: group ? undefined : input.appSession.displayName,
      messages: history.messages,
      transcriptStatus: history.status,
    }),
  };
}

function createChatroomTranscriptDocument(input: {
  locale: Locale;
  courseName?: string;
  groupName?: string;
  memberNames: string[];
  fallbackStudentName?: string;
  messages: LearningChatroomTranscriptMessage[];
  transcriptStatus: "loaded" | "unavailable";
}): ChatroomTranscriptDocument {
  const t = copy[input.locale];
  const messages = input.messages.map((message) => ({
    id: message.messageId,
    role: message.role,
    content: message.content,
    authorLabel:
      message.role === "agent"
        ? readAgentName(message.agentId, input.locale) ?? t.learning.groupAgents
        : message.authorName ?? input.fallbackStudentName ?? t.learning.groupMemberUnknown,
    ...(message.agentId ? { agentId: message.agentId } : {}),
    createdAt: message.createdAt,
    timeLabel: formatChatroomTimestamp(message.createdAt),
  }));

  return {
    locale: input.locale,
    ...(input.courseName ? { courseName: input.courseName } : {}),
    ...(input.groupName ? { groupName: input.groupName } : {}),
    memberNames: input.memberNames,
    messages,
    messageCount: messages.length,
    ...(messages.length > 0
      ? {
          dateRange: {
            startLabel: messages[0].timeLabel,
            endLabel: messages[messages.length - 1].timeLabel,
          },
        }
      : {}),
    transcriptStatus: input.transcriptStatus,
  };
}

async function readChatroomCourseDatabase(
  input: ChatroomTranscriptViewDeps,
): Promise<
  { status: "loaded"; database: TeachingCourseManagementDatabase } | { status: "unavailable"; database?: undefined }
> {
  try {
    const repository =
      input.courseRepository ??
      createUaisTeachingCourseManagementRepository({
        env: input.env,
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
    if (!repository) {
      assertTeachingCourseManagementLocalJsonRuntimeAllowed(input.env);
    }
    const { database } = await readTeachingCourseManagementSnapshot({
      dataDir: resolveTeachingCourseManagementDataDir(
        input.env.UAIS_TEACHING_COURSES_DATA_DIR,
      ),
      ...(repository ? { repository } : {}),
    });
    return { status: "loaded", database };
  } catch {
    return { status: "unavailable" };
  }
}

function readCourseName(
  database: TeachingCourseManagementDatabase | undefined,
  courseId: string,
) {
  return database?.courses.find((course) => course.courseId === courseId)?.courseName;
}

// Display-name lookup for a legacy room's owner. The membership record is the
// same place the roster snapshot comes from, so no new projection is invented.
function readStudentDisplayName(
  database: TeachingCourseManagementDatabase | undefined,
  input: { courseId: string; studentId: string },
) {
  return database?.memberships.find(
    (membership) =>
      membership.courseId === input.courseId && membership.studentId === input.studentId,
  )?.studentDisplayName;
}

function readAgentName(agentId: string | undefined, locale: Locale) {
  if (!agentId) {
    return undefined;
  }
  return aiAgents.find((agent) => agent.id === agentId)?.name[locale];
}

// Deterministic, timezone-free and locale-free on purpose: this string is
// rendered on a server-only document that may be printed or shared across
// timezones, so it must not depend on the renderer's clock settings.
export function formatChatroomTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return `${new Date(parsed).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function isLearningChatroomGroupsModeEnabled(env: Record<string, string | undefined>) {
  return env.UAIS_LEARNING_CHATROOM_GROUPS_MODE?.trim().toLowerCase() === "on";
}
