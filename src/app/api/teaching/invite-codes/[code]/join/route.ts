import { randomUUID } from "node:crypto";
import type { AiRequestRateLimiter } from "@/lib/server/ai-request-rate-limit";
import {
  createTeachingInviteJoinRateLimiter,
  resolveTeachingInviteJoinRateLimitKey,
} from "@/lib/server/teaching-invite-join-rate-limit";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import { resolveUaisAppAuthProviderContract } from "@/lib/server/uais-app-auth-provider";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  joinTeachingClassByInviteCode,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";

export const dynamic = "force-dynamic";

type TeachingInviteCodeJoinRouteContext = {
  params: { code: string } | Promise<{ code: string }>;
};

type TeachingInviteCodeJoinPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  hasTrustedAccountProvider?: boolean;
  // Injected so a suite can drive the throttle windows without sleeping. The
  // limiter itself is per handler instance, exactly like the AI routes'.
  rateLimiter?: AiRequestRateLimiter;
};

type AuthenticatedStudent = {
  actorId: string;
  displayName: string;
  role: "student";
  authSession: TeachingCourseManagementAuthSessionSummary;
};

type AuthenticatedTeacher = {
  actorId: string;
  role: "teacher";
};

type InviteJoinDeniedResource = {
  invitationCode: string;
};

type DeniedAccessReasonCode =
  | "student-session-required"
  | "student-role-required"
  | "student-auth-provider-not-production-ready"
  | "class-invite-code-not-found"
  | "student-course-membership-already-exists";

export const POST = createTeachingInviteCodeJoinPostHandler();

export function createTeachingInviteCodeJoinPostHandler(
  deps: TeachingInviteCodeJoinPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const rateLimiter = deps.rateLimiter ?? createTeachingInviteJoinRateLimiter();

  return async function POST(request: Request, context: TeachingInviteCodeJoinRouteContext) {
    const traceId = readSafeTraceId(request);
    let authenticatedStudent: AuthenticatedStudent | undefined;
    let deniedResource: InviteJoinDeniedResource | undefined;
    try {
      const authenticatedTeacher = readAuthenticatedTeacher({
        request,
        env,
        now: deps.now,
      });
      if (authenticatedTeacher) {
        return jsonResponse(403, {
          error: "UAIS student role is required.",
          traceId,
          access: createDeniedAccess("student-role-required", authenticatedTeacher),
          redaction: createRedaction(),
        }, traceId);
      }

      authenticatedStudent = readAuthenticatedStudent({
        request,
        env,
        now: deps.now,
      });
      if (!authenticatedStudent) {
        return jsonResponse(401, {
          error: "UAIS student authentication is required.",
          traceId,
          access: createDeniedAccess("student-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }
      const authProviderContract = resolveUaisAppAuthProviderContract({
        env,
        hasTrustedAccountProvider: Boolean(deps.hasTrustedAccountProvider),
      });
      if (
        isTeachingInviteJoinProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS app auth provider is not production-ready.",
          traceId,
          access: createDeniedAccess(
            "student-auth-provider-not-production-ready",
            authenticatedStudent,
          ),
          authProviderContract,
          redaction: createRedaction(),
        }, traceId);
      }
      // Throttled once the caller is known and before any storage read: the
      // invite code is the only credential this route asks for, so an
      // unthrottled authenticated caller can walk the code space until they land
      // in a class that is not theirs. Keyed on the account, which the session
      // proves, rather than on anything the client can vary.
      const rateLimit = rateLimiter.check({
        key: resolveTeachingInviteJoinRateLimitKey(authenticatedStudent.actorId),
        nowMs: (deps.now ?? new Date()).getTime(),
      });
      if (!rateLimit.allowed) {
        return jsonResponse(429, {
          error: "UAIS teaching invite-code join rate limit reached.",
          traceId,
          reasonCode: "invite-join-rate-limited",
          // A 429 without Retry-After tells a client nothing, so it retries
          // straight back into the same rejection. The limiter already computed
          // a never-zero value.
          retryAfterSeconds: rateLimit.retryAfterSeconds,
          redaction: createRedaction(),
        }, traceId, { "retry-after": String(rateLimit.retryAfterSeconds) });
      }

      const courseManagementRepository = createUaisTeachingCourseManagementRepository({
        env,
        fetch: deps.fetch,
      });
      if (!courseManagementRepository) {
        assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
      }

      const params = await context.params;
      deniedResource = readInviteJoinDeniedResource(params.code);
      const { membership, receipt } = await joinTeachingClassByInviteCode({
        dataDir: resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR),
        repository: courseManagementRepository,
        join: {
          invitationCode: params.code,
          studentId: authenticatedStudent.actorId,
          studentDisplayName: authenticatedStudent.displayName,
        },
        traceId,
        now: deps.now,
        audit: {
          requestSource: readAuditRequestSource(request),
          authSession: authenticatedStudent.authSession,
        },
      });

      return jsonResponse(201, {
        membership,
        receipt,
        traceId,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId, authenticatedStudent, deniedResource);
    }
  };
}

function isTeachingInviteJoinProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function readAuthenticatedStudent(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedStudent | undefined {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  const displayName = claims
    ? readSafeTeachingInviteStudentDisplayName(claims.displayName)
    : undefined;
  if (
    !claims ||
    claims.role !== "student" ||
    !isSafeTeachingInviteStudentActorId(claims.account) ||
    !isSafeTeachingInviteStudentActorId(claims.sessionId) ||
    !displayName
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    displayName,
    role: "student",
    authSession: {
      sessionId: claims.sessionId,
      authenticatedAt: claims.authenticatedAt,
      expiresAt: claims.expiresAt,
    },
  };
}

function readAuthenticatedTeacher(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): AuthenticatedTeacher | undefined {
  const secret = input.env.UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET?.trim();
  if (!secret) {
    return undefined;
  }
  const session = readUaisAuthenticatedTeacherSessionFromSignedCookies({
    request: input.request,
    secret,
    now: input.now,
  });
  if (
    !session ||
    session.role !== "teacher" ||
    !isSafeTeachingInviteStudentActorId(session.actorId) ||
    !isSafeTeachingInviteStudentActorId(session.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: session.actorId,
    role: session.role,
  };
}

function isSafeTeachingInviteStudentActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function readSafeTeachingInviteStudentDisplayName(value: string) {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    /\/Users\/|\\Users\\|secret|api[_-]?key|token/i.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function readAuditRequestSource(request: Request) {
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted" as const,
  };
}

function sanitizeRequestSourceHeader(value: string | null) {
  const normalized = value?.trim().slice(0, 160);
  if (!normalized) {
    return undefined;
  }
  if (/\/Users\/|secret|api[_-]?key|token/i.test(normalized)) {
    return "redacted";
  }
  return normalized;
}

function createErrorResponse(
  error: unknown,
  traceId: string,
  authenticatedStudent?: AuthenticatedStudent,
  deniedResource?: InviteJoinDeniedResource,
) {
  if (error instanceof TeachingCourseManagementStoreError) {
    const access = createDeniedAccessForStoreError(
      error,
      authenticatedStudent,
      deniedResource,
    );
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      // Enrolment day contention answers 409 with a stable code beside the
      // prose, so the join UI can tell "the class row was busy, try again" apart
      // from "this code does not exist" without matching on English.
      ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
      ...(access ? { access } : {}),
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching invite-code join request failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function jsonResponse(
  status: number,
  body: unknown,
  traceId: string,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
      ...headers,
    },
  });
}

function createDeniedAccess(
  reasonCode: DeniedAccessReasonCode,
  actor?: AuthenticatedStudent | AuthenticatedTeacher,
  resource?: InviteJoinDeniedResource,
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor
      ? {
          actor: {
            actorId: actor.actorId,
            ...("displayName" in actor ? { displayName: actor.displayName } : {}),
            role: actor.role,
          },
        }
      : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function createDeniedAccessForStoreError(
  error: TeachingCourseManagementStoreError,
  authenticatedStudent?: AuthenticatedStudent,
  deniedResource?: InviteJoinDeniedResource,
) {
  if (error.status === 404 && error.message === "Teaching class invite code was not found.") {
    return createDeniedAccess(
      "class-invite-code-not-found",
      authenticatedStudent,
      deniedResource,
    );
  }
  if (
    error.status === 409 &&
    error.message === "Student already has a membership in this teaching course."
  ) {
    return createDeniedAccess(
      "student-course-membership-already-exists",
      authenticatedStudent,
      deniedResource,
    );
  }
  return undefined;
}

function readInviteJoinDeniedResource(invitationCode: string): InviteJoinDeniedResource | undefined {
  return /^\d{8}$/.test(invitationCode) ? { invitationCode } : undefined;
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
