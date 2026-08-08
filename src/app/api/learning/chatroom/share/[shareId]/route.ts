import {
  authorizeLearningAiGuideCourseAccess,
  createLearningAiGuideAccessRedaction,
} from "@/lib/server/learning-ai-guide-access";
import {
  isLearningChatroomShareActive,
  LearningChatroomShareStoreError,
  readLearningChatroomShare,
  resolveLearningChatroomShareDataDir,
  revokeLearningChatroomShare,
  type LearningChatroomShareRecord,
  type LearningChatroomShareRepository,
} from "@/lib/server/learning-chatroom-share-store";
import { getUaisAppSessionUserFromCookieString } from "@/lib/server/uais-app-session";
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
};

type LearningChatroomShareRouteContext = {
  params: { shareId: string } | Promise<{ shareId: string }>;
};

export const DELETE = createLearningChatroomShareRevokeDeleteHandler();

export function createLearningChatroomShareRevokeDeleteHandler(
  deps: LearningChatroomShareRevokeHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;

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

      const { shareId } = await context.params;
      const dataDir = resolveLearningChatroomShareDataDir(env);
      const record = await readLearningChatroomShare({
        dataDir,
        env,
        ...(deps.shareRepository ? { repository: deps.shareRepository } : {}),
        shareId,
      });
      if (!isLearningChatroomShareActive(record)) {
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
        ...(deps.shareRepository ? { repository: deps.shareRepository } : {}),
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
  // stop a link comes from owning the course, not from being able to observe the
  // group, so revocation keeps working when the group is already gone.
  const access = await authorizeLearningAiGuideCourseAccess({
    appSession: { account: input.appSession.account, role: input.appSession.role },
    env: input.env,
    ...(input.fetch ? { fetch: input.fetch } : {}),
    ...(input.repository ? { repository: input.repository } : {}),
    courseId: input.record.courseId,
    intent: "read",
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

function jsonResponse(status: number, body: unknown, traceId: string) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
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

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicLearningChatroomShareError";
    this.status = status;
  }
}
