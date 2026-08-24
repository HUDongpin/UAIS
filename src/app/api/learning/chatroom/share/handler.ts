import { createAiRequestRateLimiter } from "@/lib/server/ai-request-rate-limit";
import {
  authorizeLearningAiGuideCourseAccess,
  createLearningAiGuideAccessDeniedMessage,
  createLearningAiGuideAccessRedaction,
  createLearningChatroomGroupsDisabledAccessDecision,
  type LearningAiGuideCourseAccessDecision,
} from "@/lib/server/learning-ai-guide-access";
import { isLearningChatroomGroupsEnabled } from "@/lib/server/learning-chatroom-groups-flag";
import {
  createLearningChatroomShare,
  learningChatroomShareMaxTtlMs,
  LearningChatroomShareStoreError,
  type LearningChatroomShareRepository,
} from "@/lib/server/learning-chatroom-share-store";
import { resolveLearningChatroomShareBackend } from "@/lib/server/learning-chatroom-share-runtime";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
import type { TeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-store";

// Mints a share link for one chatroom room (plan D8, Phase 5).
//
// A share record is a capability, not an export: it names a room, and
// `/share/[shareId]` renders that room live. So minting is gated by exactly the
// access the chatroom GET requires for the same room - course gate, group
// membership when `groupId` is present, and the feature flag. Participants mint;
// since the course-owning teacher participates in their own course's group
// rooms, they may mint one too, which grants no exposure they did not already
// have - they can read the room, and they can revoke any link in the course
// (sibling DELETE route).
type LearningChatroomShareMintHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  shareRepository?: LearningChatroomShareRepository;
  courseRepository?: TeachingCourseManagementRepository;
  createShareId?: () => string;
};

const learningChatroomShareMaxIdLength = 200;
// Minting spends no provider money and one small snapshot write, so this limiter
// is about refusing a client stuck in a loop rather than about cost. It is
// deliberately NOT env-tunable: the release env catalog is closed for this
// phase, and a fixed, generous ceiling needs no operator decision.
const learningChatroomShareRateLimitPerMinute = 10;
const learningChatroomShareRateLimitPerDay = 200;
const learningChatroomShareRateLimitMessage =
  "Learning chatroom share rate limit exceeded. Please wait before creating another link.";

export function createLearningChatroomShareMintPostHandler(
  deps: LearningChatroomShareMintHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const rateLimiter = createAiRequestRateLimiter({
    config: {
      mode: "enforce",
      windows: [
        {
          id: "per-minute",
          limit: learningChatroomShareRateLimitPerMinute,
          windowMs: 60000,
        },
        {
          id: "per-day",
          limit: learningChatroomShareRateLimitPerDay,
          windowMs: 86400000,
        },
      ],
    },
  });

  return async function POST(request: Request) {
    const traceId = readSafeTraceId(request);
    try {
      const appSession = getUaisAppSessionUserFromCookieString(
        request.headers.get("cookie"),
        { env },
      );
      if (!appSession) {
        throw new PublicLearningChatroomShareError(
          "UAIS app session is required for learning chatroom sharing.",
          401,
        );
      }

      const body = parseShareMintRequest(await readJsonBody(request), now());

      // Throttled before the authorization store read, so a looping client costs
      // no snapshot round trip. Keyed on the actor alone for the same reason the
      // chatroom limiters are: membership is not verified yet, so a
      // course-scoped key would hand out a fresh budget per invented courseId.
      const rateLimit = rateLimiter.check({ key: appSession.account, nowMs: now() });
      if (!rateLimit.allowed) {
        throw new PublicLearningChatroomShareError(
          learningChatroomShareRateLimitMessage,
          429,
          { retryAfterSeconds: rateLimit.retryAfterSeconds },
        );
      }

      if (body.groupId && !isLearningChatroomGroupsEnabled(env)) {
        return createAccessDeniedResponse({
          traceId,
          reasonCode: "share-membership-required",
          access: createLearningChatroomGroupsDisabledAccessDecision({
            appSession,
            courseId: body.courseId,
            groupId: body.groupId,
          }),
        });
      }

      const access = await authorizeLearningAiGuideCourseAccess({
        appSession: { account: appSession.account, role: appSession.role },
        env,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.courseRepository ? { repository: deps.courseRepository } : {}),
        courseId: body.courseId,
        ...(body.groupId ? { groupId: body.groupId } : {}),
      });
      if (access.status === "denied") {
        return createAccessDeniedResponse({
          traceId,
          reasonCode: "share-membership-required",
          access,
        });
      }

      // Minting a group link stays MEMBER-ONLY, even though the teacher is a
      // full participant in the room. Reading a room as its course owner and
      // publishing it to a signed-out URL are different exposures, and the
      // members - whose display names and messages the public page renders -
      // cannot revoke a link they did not create. A teacher who needs the room
      // off-platform uses the print view instead. This check is explicit rather
      // than riding the authorizer, so the rule cannot be lost again by a
      // change to the room's own access policy.
      if (body.groupId && access.reasonCode === "teacher-group-participant-approved") {
        return createAccessDeniedResponse({
          traceId,
          reasonCode: "share-membership-required",
          access: {
            ...access,
            status: "denied",
            reasonCode: "teacher-group-share-member-only",
          },
        });
      }

      // The class scope of a group room comes from the group record, exactly as
      // in the chatroom handlers: a link minted without `classId` must still
      // point at the same room the member is reading.
      const classId = access.group ? access.group.classId : body.classId;
      // Resolves the durable backend when one is configured, and refuses a
      // production runtime that would otherwise mint into an ephemeral file.
      const shareBackend = resolveLearningChatroomShareBackend({
        env,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.shareRepository ? { repository: deps.shareRepository } : {}),
      });
      const { record, receipt } = await createLearningChatroomShare({
        dataDir: shareBackend.dataDir,
        env,
        ...(shareBackend.repository ? { repository: shareBackend.repository } : {}),
        ...(deps.createShareId ? { shareId: deps.createShareId() } : {}),
        courseId: body.courseId,
        ...(classId ? { classId } : {}),
        ...(access.group ? { groupId: access.group.groupId } : {}),
        createdBy: appSession.account,
        now: new Date(now()).toISOString(),
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      });

      const sharePath = `/share/${record.shareId}`;
      return jsonResponse(
        201,
        {
          // `createdBy` is deliberately absent: it is an account id, and a share
          // response is display-safe data only.
          share: {
            shareId: record.shareId,
            courseId: record.courseId,
            ...(record.classId ? { classId: record.classId } : {}),
            ...(record.groupId ? { groupId: record.groupId } : {}),
            createdAt: record.createdAt,
            // Returned so the room can tell whoever copied the link when it
            // stops working, instead of the link simply going dead one day.
            expiresAt: record.expiresAt,
          },
          sharePath,
          shareUrl: `${readRequestOrigin(request)}${sharePath}`,
          receipt,
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

function parseShareMintRequest(value: unknown, nowMs: number) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublicLearningChatroomShareError("Request body must be an object.", 400);
  }
  const record = value as Record<string, unknown>;
  const courseId = readString(record.courseId);
  if (!courseId || courseId.length > learningChatroomShareMaxIdLength) {
    throw new PublicLearningChatroomShareError(
      "Learning chatroom share courseId must be 1-200 characters.",
      400,
    );
  }

  return {
    courseId,
    classId: readBoundedId(record.classId, "classId"),
    groupId: readBoundedId(record.groupId, "groupId"),
    expiresAt: readShareExpiresAt(record.expiresAt, nowMs),
  };
}

// Optional: absent means the store's 14-day default. A named moment is refused
// rather than clamped when it is unreadable, already past, or beyond the ceiling
// - a minter who asked for a link lasting a year should be told the answer is
// no, not handed a link that quietly lasts three months.
function readShareExpiresAt(value: unknown, nowMs: number) {
  const expiresAt = readString(value);
  if (!expiresAt) {
    return "";
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw new PublicLearningChatroomShareError(
      "Learning chatroom share expiresAt must be a future ISO timestamp.",
      400,
    );
  }
  if (expiresAtMs > nowMs + learningChatroomShareMaxTtlMs) {
    throw new PublicLearningChatroomShareError(
      "Learning chatroom share expiresAt must be within 90 days.",
      400,
    );
  }
  return new Date(expiresAtMs).toISOString();
}

function readBoundedId(value: unknown, label: string) {
  const id = readString(value);
  if (id.length > learningChatroomShareMaxIdLength) {
    throw new PublicLearningChatroomShareError(
      `Learning chatroom share ${label} must be at most 200 characters.`,
      400,
    );
  }
  return id;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new PublicLearningChatroomShareError("Request body must be an object.", 400);
  }
}

// A public link must be copyable straight into a message, so the response
// carries the absolute URL. The forwarded headers are validated rather than
// trusted verbatim: they end up inside a URL the client copies.
function readRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host =
    forwardedHost && /^[a-zA-Z0-9.\-:]{1,253}$/.test(forwardedHost)
      ? forwardedHost
      : url.host;
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

function createAccessDeniedResponse(input: {
  traceId: string;
  reasonCode: "share-membership-required";
  access: Extract<LearningAiGuideCourseAccessDecision, { status: "denied" }>;
}) {
  return jsonResponse(
    403,
    {
      error: createLearningAiGuideAccessDeniedMessage(input.access.reasonCode),
      reasonCode: input.reasonCode,
      traceId: input.traceId,
      // The underlying chatroom decision rides along unchanged, so a share
      // denial is diagnosable with the same reason codes as the room itself.
      access: input.access,
      redaction: createLearningAiGuideAccessRedaction(),
    },
    input.traceId,
  );
}

function createErrorResponse(input: { error: unknown; traceId: string }) {
  const publicError = readPublicError(input.error);
  const status = publicError?.status ?? 500;
  const message = publicError?.message ?? "Learning chatroom share request failed.";
  if (status >= 500) {
    console.error("[learning-chatroom-share]", {
      traceId: input.traceId,
      phase: "request",
      message: input.error instanceof Error ? input.error.message : message,
    });
  }
  return jsonResponse(
    status,
    {
      error: message,
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
  if (error instanceof PublicLearningChatroomShareError) {
    return error;
  }
  if (error instanceof LearningChatroomShareStoreError) {
    return new PublicLearningChatroomShareError(error.message, error.status);
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
  return `trace-learning-chatroom-share-${crypto.randomUUID()}`;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

class PublicLearningChatroomShareError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, options?: { retryAfterSeconds?: number }) {
    super(message);
    this.name = "PublicLearningChatroomShareError";
    this.status = status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}
