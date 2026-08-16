import {
  authorizeLearningAiGuideCourseAccess,
  createLearningAiGuideAccessRedaction,
} from "@/lib/server/learning-ai-guide-access";
import {
  isLearningChatroomShareActive,
  LearningChatroomShareStoreError,
  readLearningChatroomShare,
  revokeLearningChatroomShare,
  type LearningChatroomShareRecord,
  type LearningChatroomShareRepository,
} from "@/lib/server/learning-chatroom-share-store";
import { resolveLearningChatroomShareBackend } from "@/lib/server/learning-chatroom-share-runtime";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
import {
  createAiRequestRateLimiter,
  type AiRequestRateLimiter,
} from "@/lib/server/ai-request-rate-limit";
import type { TeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-store";

// Revokes one share link (plan D8, Phase 5).
//
// Two principals may revoke: the member who minted the link, and the teacher who
// owns the course it points at. The first is the person who published it; the
// second is the person accountable for the classroom - a link a student minted
// and then left behind must still be stoppable.
//
// An unknown id and an already-revoked id answer the same 404 as the public page
// does, so nobody can probe which links exist.
export const dynamic = "force-dynamic";

type LearningChatroomShareRevokeHandlerDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  shareRepository?: LearningChatroomShareRepository;
  courseRepository?: TeachingCourseManagementRepository;
  // Injected by tests so a suite drives the windows through its own clock
  // instead of waiting on wall time.
  rateLimiter?: AiRequestRateLimiter;
};

type LearningChatroomShareRouteContext = {
  params: { shareId: string } | Promise<{ shareId: string }>;
};

// Revoking is cheap but not free: every call is a shares-snapshot read and, when
// it succeeds, a read-modify-write of the whole database. Session-gating alone
// left a signed-in client able to loop on it, so it gets the same fixed,
// non-env-tunable ceiling the mint route uses - generous enough that no real
// teacher or student reaches it, low enough that a loop stops costing snapshot
// round trips. Kept slightly higher than minting because revocation is the
// safety valve and must not be the thing that runs out first.
const learningChatroomShareRevokeRateLimitPerMinute = 20;
const learningChatroomShareRevokeRateLimitPerDay = 400;
const learningChatroomShareRevokeRateLimitMessage =
  "Learning chatroom share rate limit exceeded. Please wait before revoking another link.";

export const DELETE = createLearningChatroomShareRevokeDeleteHandler();

export function createLearningChatroomShareRevokeDeleteHandler(
  deps: LearningChatroomShareRevokeHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const rateLimiter =
    deps.rateLimiter ??
    createAiRequestRateLimiter({
      config: {
        mode: "enforce",
        windows: [
          {
            id: "per-minute",
            limit: learningChatroomShareRevokeRateLimitPerMinute,
            windowMs: 60000,
          },
          {
            id: "per-day",
            limit: learningChatroomShareRevokeRateLimitPerDay,
            windowMs: 86400000,
          },
        ],
      },
    });

  return async function DELETE(
    request: Request,
    context: LearningChatroomShareRouteContext,
  ) {
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

      // Checked before the shares read, so a looping caller costs no snapshot
      // round trip. Keyed on the actor alone, like the mint and chatroom
      // limiters: ownership is not established yet, so a share-scoped key would
      // hand out a fresh budget per invented share id.
      const rateLimit = rateLimiter.check({ key: appSession.account, nowMs: now() });
      if (!rateLimit.allowed) {
        throw new PublicLearningChatroomShareError(
          learningChatroomShareRevokeRateLimitMessage,
          429,
          { retryAfterSeconds: rateLimit.retryAfterSeconds },
        );
      }

      const { shareId } = await context.params;
      const shareBackend = resolveLearningChatroomShareBackend({
        env,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.shareRepository ? { repository: deps.shareRepository } : {}),
      });
      const dataDir = shareBackend.dataDir;
      const record = await readLearningChatroomShare({
        dataDir,
        env,
        ...(shareBackend.repository ? { repository: shareBackend.repository } : {}),
        shareId,
      });
      // Expiry is judged on the handler's own clock, the same one the revocation
      // below is stamped with: an already-expired link is a 404 here exactly as
      // it is on the public page, so revoking it reports the same "not found" a
      // second revoker gets.
      if (!isLearningChatroomShareActive(record, { nowMs: now() })) {
        return createShareNotFoundResponse(traceId);
      }

      const allowed = await isLearningChatroomShareRevocationAllowed({
        appSession,
        record,
        env,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.courseRepository ? { repository: deps.courseRepository } : {}),
      });
      if (!allowed) {
        return jsonResponse(
          403,
          {
            error: "UAIS learning chatroom share revocation requires the creator or the course teacher.",
            reasonCode: "share-revocation-denied",
            traceId,
            access: {
              status: "denied" as const,
              reasonCode: "share-revocation-denied" as const,
              actor: { actorId: appSession.account, role: appSession.role },
              resource: {
                courseId: record.courseId,
                ...(record.groupId ? { groupId: record.groupId } : {}),
              },
              responsibleSession: "S12" as const,
              redaction: createLearningAiGuideAccessRedaction(),
            },
            redaction: createLearningAiGuideAccessRedaction(),
          },
          traceId,
        );
      }

      const revocation = await revokeLearningChatroomShare({
        dataDir,
        env,
        ...(shareBackend.repository ? { repository: shareBackend.repository } : {}),
        shareId: record.shareId,
        now: new Date(now()).toISOString(),
      });
      // Lost a race with another revoker: the link is already dead, which is the
      // same outcome the caller asked for, reported the same way as an unknown id.
      if (revocation.status === "not-found") {
        return createShareNotFoundResponse(traceId);
      }

      return jsonResponse(
        200,
        {
          share: {
            shareId: revocation.record.shareId,
            courseId: revocation.record.courseId,
            ...(revocation.record.classId ? { classId: revocation.record.classId } : {}),
            ...(revocation.record.groupId ? { groupId: revocation.record.groupId } : {}),
            createdAt: revocation.record.createdAt,
            expiresAt: revocation.record.expiresAt,
            revokedAt: revocation.record.revokedAt,
          },
          receipt: revocation.receipt,
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

async function isLearningChatroomShareRevocationAllowed(input: {
  appSession: { account: string; role: "teacher" | "student" | "admin" };
  record: LearningChatroomShareRecord;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  repository?: TeachingCourseManagementRepository;
}) {
  if (input.appSession.account === input.record.createdBy) {
    return true;
  }
  if (input.appSession.role !== "teacher") {
    // A co-member of the group can read the room but did not publish the link,
    // so withdrawing someone else's publication is not theirs to do.
    return false;
  }

  // Course ownership only - deliberately without `groupId`. A teacher's right to
  // stop a link comes from owning the course, not from being in the group, so
  // revocation keeps working when the group is already gone.
  const access = await authorizeLearningAiGuideCourseAccess({
    appSession: { account: input.appSession.account, role: input.appSession.role },
    env: input.env,
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.repository ? { repository: input.repository } : {}),
    courseId: input.record.courseId,
  });
  return (
    access.status === "authorized" &&
    access.reasonCode === "teacher-course-ownership-approved"
  );
}

function createShareNotFoundResponse(traceId: string) {
  return jsonResponse(
    404,
    {
      error: "UAIS learning chatroom share was not found.",
      reasonCode: "share-not-found",
      traceId,
      redaction: createLearningAiGuideAccessRedaction(),
    },
    traceId,
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
    publicError?.retryAfterSeconds,
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
  retryAfterSeconds?: number,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
      // Only a throttle carries it, so a client can wait the stated whole
      // seconds instead of guessing.
      ...(retryAfterSeconds ? { "retry-after": String(retryAfterSeconds) } : {}),
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
