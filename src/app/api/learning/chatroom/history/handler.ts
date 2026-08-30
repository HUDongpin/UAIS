import {
  createAiRequestRateLimiter,
  resolveAiRequestRateLimitCount,
  resolveAiRequestRateLimitMode,
} from "@/lib/server/ai-request-rate-limit";
import {
  authorizeLearningAiGuideCourseAccess,
  createLearningAiGuideAccessDeniedResponse,
  createLearningAiGuideCourseContextRequiredAccessDecision,
  createLearningChatroomGroupsDisabledAccessDecision,
  type LearningChatroomGroupProjection,
} from "@/lib/server/learning-ai-guide-access";
import { isLearningChatroomGroupsEnabled } from "@/lib/server/learning-chatroom-groups-flag";
import {
  readLearningChatroomHistory,
  type LearningChatroomHistoryResult,
  type LearningChatroomTranscriptRoomKey,
} from "@/lib/server/learning-chatroom-transcript-runtime";
import type {
  LearningChatroomTranscriptMessage,
  LearningChatroomTranscriptRepository,
} from "@/lib/server/learning-chatroom-transcript-store";
import type { TeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-types";
import { TeachingCourseManagementStoreError } from "@/lib/server/teaching-course-management-error";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";

export type LearningChatroomHistoryGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  teachingRepository?: TeachingCourseManagementRepository;
  timingNow?: () => number;
  transcriptRepository?: LearningChatroomTranscriptRepository;
};

const historyDefaultRateLimitPerMinute = 30;
const historyDefaultRateLimitPerDay = 2000;
const historyRateLimitMessage =
  "Learning chatroom history rate limit exceeded. Please wait before reloading the transcript.";
const timingSpanOrder = [
  "entry",
  "session",
  "rate",
  "backend",
  "pool",
  "authorization",
  "transcript",
  "projection",
  "total",
] as const;
type TimingSpanName = (typeof timingSpanOrder)[number];

// This handler is intentionally independent from ../handler.ts. The legacy
// GET stays there during migration, while this route avoids evaluating the
// AI-heavy POST graph on a polling read.
export function createLearningChatroomHistoryGetHandler(
  deps: LearningChatroomHistoryGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const timingNow = deps.timingNow ?? defaultTimingNow;
  const readPendingTranscript = createPendingTranscriptReadSingleFlight();
  const rateLimiter = createAiRequestRateLimiter({
    config: readHistoryRateLimitConfig(env),
  });

  return async function GET(request: Request) {
    const timing = createHistoryTimingRecorder(timingNow);
    const traceId = timing.measure("entry", () => readSafeTraceId(request));
    let courseId: string | undefined;

    try {
      const appSession = timing.measure("session", () =>
        getUaisAppSessionUserFromCookieString(request.headers.get("cookie"), {
          env,
        }),
      );
      if (!appSession) {
        throw new PublicHistoryError(
          "UAIS app session is required for the learning chatroom.",
          401,
        );
      }

      const room = timing.measure("entry", () => parseHistoryQuery(request));
      courseId = room.courseId;
      if (!room.courseId) {
        return timing.finalize(
          createLearningAiGuideAccessDeniedResponse({
            access: createLearningAiGuideCourseContextRequiredAccessDecision({
              appSession,
            }),
            traceId,
          }),
        );
      }

      const actorId = `app-session-${readGraphRole(appSession.role)}-${toSafeActorIdSegment(
        appSession.account,
      )}`;
      const rateLimit = timing.measure("rate", () =>
        rateLimiter.check({ key: actorId, nowMs: now() }),
      );
      if (!rateLimit.allowed) {
        logHistoryThrottle({
          traceId,
          windowId: rateLimit.windowId,
          limit: rateLimit.limit,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });
        throw new PublicHistoryError(historyRateLimitMessage, 429, {
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });
      }

      if (room.groupId && !isLearningChatroomGroupsEnabled(env)) {
        return timing.finalize(
          createLearningAiGuideAccessDeniedResponse({
            access: createLearningChatroomGroupsDisabledAccessDecision({
              appSession,
              courseId: room.courseId,
              groupId: room.groupId,
            }),
            traceId,
          }),
        );
      }

      const access = await timing.measureAsync("authorization", () =>
        authorizeLearningAiGuideCourseAccess({
          appSession,
          env,
          fetch: deps.fetch,
          courseId: room.courseId,
          ...(room.groupId ? { groupId: room.groupId } : {}),
          ...(deps.teachingRepository
            ? { repository: deps.teachingRepository }
            : {}),
          timingNow,
          onTiming: (span) => timing.record(span.name, span.durationMs),
        }),
      );
      if (access.status === "denied") {
        return timing.finalize(
          createLearningAiGuideAccessDeniedResponse({ access, traceId }),
        );
      }

      const group = access.group;
      const transcriptRoom = createTranscriptRoom({
        courseId: room.courseId,
        classId: room.classId,
        group,
        studentId: appSession.account,
      });
      const history = await timing.measureAsync("transcript", () =>
        readPendingTranscript(transcriptRoom, () =>
          readLearningChatroomHistory({
            env,
            fetch: deps.fetch,
            repository: deps.transcriptRepository,
            ...transcriptRoom,
          }),
        ),
      );
      if (history.status === "unavailable") {
        logHistoryStorageFailure({ traceId, phase: "transcript-read" });
      }

      const response = timing.measure("projection", () =>
        historyJsonResponse(
          200,
          {
            courseId: room.courseId,
            ...(transcriptRoom.classId ? { classId: transcriptRoom.classId } : {}),
            ...(group
              ? {
                  groupId: group.groupId,
                  groupName: group.groupName,
                  members: group.members,
                }
              : {}),
            messages: history.messages.map((message) =>
              createHistoryMessage(message, {
                isGroupRoom: Boolean(group),
                account: appSession.account,
              }),
            ),
            transcript: {
              status: history.status,
              messageCount: history.messages.length,
              window: history.window,
              ...(history.storagePolicy
                ? { storagePolicy: history.storagePolicy }
                : {}),
            },
            moderation: createModerationProjection(history),
            redaction: createHistoryRedaction(),
          },
          traceId,
        ),
      );
      return timing.finalize(response);
    } catch (error) {
      return timing.finalize(
        timing.measure("projection", () =>
          createHistoryErrorResponse({ error, traceId, courseId }),
        ),
      );
    }
  };
}

function createPendingTranscriptReadSingleFlight() {
  const pending = new Map<string, Promise<LearningChatroomHistoryResult>>();
  return (
    room: LearningChatroomTranscriptRoomKey,
    read: () => Promise<LearningChatroomHistoryResult>,
  ) => {
    const key = createTranscriptReadFlightKey(room);
    const existing = pending.get(key);
    if (existing) return existing;

    const current = Promise.resolve().then(read);
    pending.set(key, current);
    const clearPendingRead = () => {
      if (pending.get(key) === current) pending.delete(key);
    };
    void current.then(clearPendingRead, clearPendingRead);
    return current;
  };
}

function createTranscriptReadFlightKey(room: LearningChatroomTranscriptRoomKey) {
  return JSON.stringify([
    room.courseId,
    room.classId ?? "",
    room.groupId ?? "",
    room.groupId ? "shared-group-room" : room.studentId,
  ]);
}

function readHistoryRateLimitConfig(env: Record<string, string | undefined>) {
  return {
    mode: resolveAiRequestRateLimitMode(
      env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE,
    ),
    windows: [
      {
        id: "per-minute",
        limit: resolveAiRequestRateLimitCount(
          env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE,
          historyDefaultRateLimitPerMinute,
        ),
        windowMs: 60_000,
      },
      {
        id: "per-day",
        limit: resolveAiRequestRateLimitCount(
          env.UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_DAY,
          historyDefaultRateLimitPerDay,
        ),
        windowMs: 86_400_000,
      },
    ],
  };
}

function parseHistoryQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const courseId = readString(params.get("courseId"));
  if (courseId.length > 200) {
    throw new PublicHistoryError(
      "Learning chatroom courseId must be 1-200 characters.",
      400,
    );
  }
  return {
    courseId,
    classId: readBoundedRoomId(params.get("classId"), "classId"),
    groupId: readBoundedRoomId(params.get("groupId"), "groupId"),
  };
}

function readBoundedRoomId(value: unknown, label: "classId" | "groupId") {
  const id = readString(value);
  if (id.length > 200) {
    throw new PublicHistoryError(
      `Learning chatroom ${label} must be at most 200 characters.`,
      400,
    );
  }
  return id;
}

function createTranscriptRoom(input: {
  courseId: string;
  classId?: string;
  group?: LearningChatroomGroupProjection;
  studentId: string;
}): LearningChatroomTranscriptRoomKey {
  const classId = input.group ? input.group.classId : input.classId;
  return {
    courseId: input.courseId,
    ...(classId ? { classId } : {}),
    ...(input.group ? { groupId: input.group.groupId } : {}),
    studentId: input.studentId,
  };
}

function createHistoryMessage(
  message: LearningChatroomTranscriptMessage,
  input: { isGroupRoom: boolean; account: string },
) {
  const replayed = {
    id: message.messageId,
    role: message.role,
    content: message.content,
    ...(message.agentId ? { agentId: message.agentId } : {}),
    createdAt: message.createdAt,
  };
  if (!input.isGroupRoom) return replayed;
  return {
    ...replayed,
    ...(message.authorName ? { authorName: message.authorName } : {}),
    ...(message.authorRole === "teacher"
      ? { authorRole: "teacher" as const }
      : {}),
    isSelf: message.role === "student" && message.authorId === input.account,
  };
}

function createModerationProjection(history: LearningChatroomHistoryResult) {
  return { status: history.moderation?.status ?? "open" };
}

function createHistoryErrorResponse(input: {
  error: unknown;
  traceId: string;
  courseId?: string;
}) {
  const publicError = createPublicHistoryError(input.error);
  const status = publicError?.status ?? 500;
  if (status >= 500) {
    logHistoryRequestFailure({
      traceId: input.traceId,
      category:
        input.error instanceof TeachingCourseManagementStoreError
          ? "authorization-store"
          : "request",
    });
  }
  return historyJsonResponse(
    status,
    {
      error: publicError?.message ?? "Learning chatroom request failed.",
      ...(publicError?.reasonCode
        ? { reasonCode: publicError.reasonCode }
        : {}),
      traceId: input.traceId,
      redaction: createHistoryRedaction(),
    },
    input.traceId,
    publicError?.retryAfterSeconds === undefined
      ? undefined
      : { "retry-after": String(publicError.retryAfterSeconds) },
  );
}

function createPublicHistoryError(error: unknown) {
  if (error instanceof PublicHistoryError) return error;
  if (error instanceof TeachingCourseManagementStoreError) {
    return new PublicHistoryError(error.message, error.status);
  }
  return undefined;
}

function historyJsonResponse(
  status: number,
  body: unknown,
  traceId: string,
  extraHeaders?: Record<string, string>,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
      ...extraHeaders,
    },
  });
}

function readSafeTraceId(request: Request) {
  const supplied = request.headers.get("x-uais-trace-id")?.trim();
  if (supplied && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(supplied)) {
    return supplied;
  }
  return `trace-learning-chatroom-${crypto.randomUUID()}`;
}

function createHistoryRedaction() {
  return { secrets: "omitted", localFiles: "omitted", assets: "ids-only" };
}

function readGraphRole(role: "teacher" | "student" | "admin") {
  if (role === "teacher") return "educator";
  if (role === "student") return "learner";
  return "admin";
}

function toSafeActorIdSegment(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._:-]+/g, "-").slice(0, 72) || "unknown";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function logHistoryThrottle(input: {
  traceId: string;
  windowId: string;
  limit: number;
  retryAfterSeconds: number;
}) {
  console.warn("[learning-chatroom-history]", {
    traceId: input.traceId,
    phase: "rate-limit",
    rateLimit: {
      windowId: input.windowId,
      limit: input.limit,
      retryAfterSeconds: input.retryAfterSeconds,
    },
    message: historyRateLimitMessage,
  });
}

function logHistoryStorageFailure(input: {
  traceId: string;
  phase: "transcript-read" | "transcript-write";
}) {
  console.error("[learning-chatroom-history]", {
    traceId: input.traceId,
    phase: input.phase,
    category: "storage-unavailable",
    message: "Learning chatroom transcript storage is unavailable.",
  });
}

function logHistoryRequestFailure(input: {
  traceId: string;
  category: "authorization-store" | "request";
}) {
  console.error("[learning-chatroom-history]", {
    traceId: input.traceId,
    phase: "request",
    category: input.category,
    message: "Learning chatroom history request failed.",
  });
}

function createHistoryTimingRecorder(now: () => number) {
  const requestStartedAt = now();
  const values = new Map<TimingSpanName, number>(
    timingSpanOrder.map((name) => [name, 0]),
  );

  function record(name: TimingSpanName, durationMs: number) {
    const bounded = boundDuration(durationMs);
    values.set(name, boundDuration((values.get(name) ?? 0) + bounded));
  }

  function measure<T>(name: TimingSpanName, run: () => T) {
    const startedAt = now();
    try {
      return run();
    } finally {
      record(name, now() - startedAt);
    }
  }

  async function measureAsync<T>(name: TimingSpanName, run: () => Promise<T>) {
    const startedAt = now();
    try {
      return await run();
    } finally {
      record(name, now() - startedAt);
    }
  }

  function finalize(response: Response) {
    values.set("total", boundDuration(now() - requestStartedAt));
    response.headers.set(
      "server-timing",
      timingSpanOrder
        .map((name) => `${name};dur=${formatDuration(values.get(name) ?? 0)}`)
        .join(", "),
    );
    return response;
  }

  return { record, measure, measureAsync, finalize };
}

function defaultTimingNow() {
  return globalThis.performance?.now() ?? Date.now();
}

function boundDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(60_000, Math.round(value * 100) / 100);
}

function formatDuration(value: number) {
  return String(Math.round(value * 100) / 100);
}

class PublicHistoryError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly reasonCode?: string;

  constructor(
    message: string,
    status: number,
    options?: { retryAfterSeconds?: number; reasonCode?: string },
  ) {
    super(message);
    this.name = "PublicHistoryError";
    this.status = status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.reasonCode = options?.reasonCode;
  }
}
