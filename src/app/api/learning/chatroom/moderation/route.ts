import { createAiRequestRateLimiter } from "@/lib/server/ai-request-rate-limit";
import {
  authorizeLearningAiGuideCourseAccess,
  createLearningAiGuideAccessDeniedResponse,
  createLearningAiGuideAccessRedaction,
  createLearningChatroomGroupsDisabledAccessDecision,
} from "@/lib/server/learning-ai-guide-access";
import { isLearningChatroomGroupsEnabled } from "@/lib/server/learning-chatroom-groups-flag";
import {
  applyLearningChatroomMessageModeration,
  applyLearningChatroomRoomModeration,
} from "@/lib/server/learning-chatroom-transcript-runtime";
import { LearningChatroomTranscriptStoreError } from "@/lib/server/learning-chatroom-transcript-store";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import type { LearningChatroomTranscriptRepository } from "@/lib/server/learning-chatroom-transcript-store";
import type { TeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-store";

// Teacher moderation for one chatroom room.
//
// The room had none: an AI-assisted group chat published a live transcript to
// every member and, through `/share`, to whoever held a link, and the only
// remedy for a message that should not be there was to delete the group. Two
// actions close that gap, and they are deliberately the smallest two that do:
//
// - hide/restore one message. The row stays stored and stays auditable; it just
//   stops replaying to the room, the export document, the PDF and the public
//   share page.
// - freeze/unfreeze the room. A frozen room refuses student posts with a
//   structured 423 and keeps taking the teacher's, so a class can be quieted
//   without being closed.
//
// Both are course-owner-only, on the same ownership check the room itself uses,
// and both are recorded on the record they acted on rather than in a parallel
// moderation store.
export const dynamic = "force-dynamic";

type LearningChatroomModerationHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  transcriptRepository?: LearningChatroomTranscriptRepository;
  courseRepository?: TeachingCourseManagementRepository;
};

type LearningChatroomModerationAction =
  | "hide-message"
  | "restore-message"
  | "freeze-room"
  | "unfreeze-room";

type LearningChatroomModerationRequest = {
  action: LearningChatroomModerationAction;
  courseId: string;
  classId: string;
  groupId: string;
  studentId: string;
  messageId: string;
};

const learningChatroomModerationMaxIdLength = 200;
// Moderation is a human, deliberate action, so the ceiling is about refusing a
// looping client rather than about cost. Fixed constants and not env names, like
// the share routes: this is not a spend knob and needs no operator decision.
const learningChatroomModerationRateLimitPerMinute = 30;
const learningChatroomModerationRateLimitPerDay = 500;
const learningChatroomModerationRateLimitMessage =
  "Learning chatroom moderation rate limit exceeded. Please wait before moderating again.";

export const POST = createLearningChatroomModerationPostHandler();

export function createLearningChatroomModerationPostHandler(
  deps: LearningChatroomModerationHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const rateLimiter = createAiRequestRateLimiter({
    config: {
      mode: "enforce",
      windows: [
        {
          id: "per-minute",
          limit: learningChatroomModerationRateLimitPerMinute,
          windowMs: 60000,
        },
        {
          id: "per-day",
          limit: learningChatroomModerationRateLimitPerDay,
          windowMs: 86400000,
        },
      ],
    },
  });

  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    try {
      const teacher = readAuthenticatedModerator({ request, env, now });
      if (!teacher) {
        throw new PublicLearningChatroomModerationError(
          "UAIS teacher authentication is required for learning chatroom moderation.",
          401,
          "moderation-teacher-session-required",
        );
      }

      const body = parseModerationRequest(await readJsonBody(request));

      // Throttled before the authorization store read, like every other chatroom
      // limiter, so a looping client costs no snapshot round trip.
      const rateLimit = rateLimiter.check({ key: teacher.actorId, nowMs: now() });
      if (!rateLimit.allowed) {
        throw new PublicLearningChatroomModerationError(
          learningChatroomModerationRateLimitMessage,
          429,
          "moderation-rate-limited",
          { retryAfterSeconds: rateLimit.retryAfterSeconds },
        );
      }

      const appSession = { account: teacher.actorId, role: "teacher" as const };
      if (body.groupId && !isLearningChatroomGroupsEnabled(env)) {
        return createLearningAiGuideAccessDeniedResponse({
          access: createLearningChatroomGroupsDisabledAccessDecision({
            appSession,
            courseId: body.courseId,
            groupId: body.groupId,
          }),
          traceId,
        });
      }

      // Course ownership - the same gate the room applies to a teacher, so a
      // teacher can moderate exactly the rooms they can already read.
      const access = await authorizeLearningAiGuideCourseAccess({
        appSession,
        env,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.courseRepository ? { repository: deps.courseRepository } : {}),
        courseId: body.courseId,
        ...(body.groupId ? { groupId: body.groupId } : {}),
      });
      if (access.status === "denied") {
        return createLearningAiGuideAccessDeniedResponse({ access, traceId });
      }

      // A group room takes its class scope from the group record, exactly as the
      // chatroom and share handlers do: a moderation call that omitted `classId`
      // must not derive a second, empty copy of the room it meant to act on.
      const classId = access.group ? access.group.classId : body.classId;
      const room = {
        courseId: body.courseId,
        ...(classId ? { classId } : {}),
        ...(access.group ? { groupId: access.group.groupId } : {}),
        // A group room is keyed by its group, so `studentId` is only creation
        // provenance there; a per-student room is keyed by the learner whose room
        // it is, which is why the request has to name them.
        studentId: access.group ? teacher.actorId : body.studentId,
      };
      const runtime = {
        env,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.transcriptRepository ? { repository: deps.transcriptRepository } : {}),
        actorId: teacher.actorId,
        now: new Date(now()).toISOString(),
      };

      const result =
        body.action === "hide-message" || body.action === "restore-message"
          ? await applyLearningChatroomMessageModeration({
              ...runtime,
              ...room,
              messageId: body.messageId,
              status: body.action === "hide-message" ? "hidden" : "visible",
            })
          : await applyLearningChatroomRoomModeration({
              ...runtime,
              ...room,
              status: body.action === "freeze-room" ? "frozen" : "open",
            });

      if (result.status === "not-found") {
        throw new PublicLearningChatroomModerationError(
          "UAIS learning chatroom message was not found in this room.",
          404,
          "moderation-message-not-found",
        );
      }

      return jsonResponse(
        200,
        {
          action: body.action,
          // The room is echoed WITHOUT `studentId`: it is a learner account id,
          // and it is the room's authorization key - the same reason the chatroom
          // GET projects display names only.
          room: {
            courseId: room.courseId,
            ...(room.classId ? { classId: room.classId } : {}),
            ...(room.groupId ? { groupId: room.groupId } : {}),
          },
          receipt: result.receipt,
          traceId,
          redaction: createLearningAiGuideAccessRedaction(),
        },
        traceId,
      );
    } catch (error) {
      return createErrorResponse({ error, traceId });
    }
  };
}

// Same two-source teacher identity the teaching routes accept: the signed
// teacher session when the deployment issues one, otherwise a UAIS app session
// carrying the teacher role. Course ownership is checked separately, so this
// answers only "who is calling", never "may they".
function readAuthenticatedModerator(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now: () => number;
}) {
  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  const nowDate = new Date(input.now());
  if (secret) {
    const session = readUaisAuthenticatedTeacherSessionFromSignedCookies({
      request: input.request,
      secret,
      now: nowDate,
    });
    if (session && session.role === "teacher" && isSafeActorId(session.actorId)) {
      return { actorId: session.actorId, authSource: "signed-teacher-session" as const };
    }
  }

  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: nowDate },
  );
  if (claims && claims.role === "teacher" && isSafeActorId(claims.account)) {
    return { actorId: claims.account, authSource: "app-session" as const };
  }
  return undefined;
}

function isSafeActorId(value: string) {
  return (
    value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  );
}

function parseModerationRequest(value: unknown): LearningChatroomModerationRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublicLearningChatroomModerationError(
      "Request body must be an object.",
      400,
      "moderation-body-invalid",
    );
  }
  const record = value as Record<string, unknown>;
  const action = readModerationAction(record.action);
  const courseId = readString(record.courseId);
  if (!courseId || courseId.length > learningChatroomModerationMaxIdLength) {
    throw new PublicLearningChatroomModerationError(
      "Learning chatroom moderation courseId must be 1-200 characters.",
      400,
      "moderation-body-invalid",
    );
  }

  const groupId = readBoundedId(record.groupId, "groupId");
  const studentId = readBoundedId(record.studentId, "studentId");
  // A room is either a group room or one learner's room, and the second kind has
  // no key without the learner. Refusing here rather than defaulting to the
  // caller keeps a teacher from silently freezing their own empty room while
  // believing they froze a student's.
  if (!groupId && !studentId) {
    throw new PublicLearningChatroomModerationError(
      "Learning chatroom moderation requires groupId or studentId.",
      400,
      "moderation-room-target-required",
    );
  }

  const messageId = readBoundedId(record.messageId, "messageId");
  if ((action === "hide-message" || action === "restore-message") && !messageId) {
    throw new PublicLearningChatroomModerationError(
      "Learning chatroom message moderation requires messageId.",
      400,
      "moderation-message-id-required",
    );
  }

  return {
    action,
    courseId,
    classId: readBoundedId(record.classId, "classId"),
    groupId,
    studentId,
    messageId,
  };
}

function readModerationAction(value: unknown): LearningChatroomModerationAction {
  if (
    value === "hide-message" ||
    value === "restore-message" ||
    value === "freeze-room" ||
    value === "unfreeze-room"
  ) {
    return value;
  }
  throw new PublicLearningChatroomModerationError(
    "Learning chatroom moderation action must be hide-message, restore-message, freeze-room, or unfreeze-room.",
    400,
    "moderation-action-invalid",
  );
}

function readBoundedId(value: unknown, label: string) {
  const id = readString(value);
  if (id.length > learningChatroomModerationMaxIdLength) {
    throw new PublicLearningChatroomModerationError(
      `Learning chatroom moderation ${label} must be at most 200 characters.`,
      400,
      "moderation-body-invalid",
    );
  }
  return id;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new PublicLearningChatroomModerationError(
      "Request body must be an object.",
      400,
      "moderation-body-invalid",
    );
  }
}

function createErrorResponse(input: { error: unknown; traceId: string }) {
  const publicError = readPublicError(input.error);
  const status = publicError?.status ?? 500;
  const message = publicError?.message ?? "Learning chatroom moderation request failed.";
  if (status >= 500) {
    console.error("[learning-chatroom-moderation]", {
      traceId: input.traceId,
      phase: "request",
      message: input.error instanceof Error ? input.error.message : message,
    });
  }
  return jsonResponse(
    status,
    {
      error: message,
      ...(publicError?.reasonCode ? { reasonCode: publicError.reasonCode } : {}),
      traceId: input.traceId,
      redaction: createLearningAiGuideAccessRedaction(),
    },
    input.traceId,
    publicError?.retryAfterSeconds === undefined
      ? undefined
      : { "retry-after": String(publicError.retryAfterSeconds) },
  );
}

function readPublicError(error: unknown) {
  if (error instanceof PublicLearningChatroomModerationError) {
    return error;
  }
  // Moderation is the one chatroom write that is not best-effort: a storage
  // failure has to reach the moderator as a failure, because a teacher told
  // "hidden" about a message their class can still read is worse than a teacher
  // told to try again.
  if (error instanceof LearningChatroomTranscriptStoreError) {
    return new PublicLearningChatroomModerationError(
      error.message,
      error.status,
      "moderation-storage-unavailable",
    );
  }
  return undefined;
}

function jsonResponse(
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
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-learning-chatroom-moderation-${crypto.randomUUID()}`;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

class PublicLearningChatroomModerationError extends Error {
  readonly status: number;
  readonly reasonCode: string;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    reasonCode: string,
    options?: { retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "PublicLearningChatroomModerationError";
    this.status = status;
    this.reasonCode = reasonCode;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}
