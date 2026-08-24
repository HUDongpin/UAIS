import { randomUUID } from "node:crypto";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  approveTeachingClassMembership,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementAuthSessionSummary,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

type TeachingClassMembershipApproveRouteContext = {
  params: Promise<{ classId: string; membershipId: string }>;
};

type TeachingClassMembershipApprovePostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

type AuthenticatedTeacher = {
  actorId: string;
  role: "teacher";
  authSession: TeachingCourseManagementAuthSessionSummary;
};

type AuthenticatedStudent = {
  actorId: string;
  role: "student";
};

type MembershipApprovalRouteParams = {
  classId: string;
  membershipId: string;
};

type DeniedAccessReasonCode =
  | "authenticated-session-required"
  | "teacher-role-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-course-ownership-required";

export function createTeachingClassMembershipApprovePostHandler(
  deps: TeachingClassMembershipApprovePostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;

  return async function POST(
    request: Request,
    context: TeachingClassMembershipApproveRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    let authenticatedTeacher: AuthenticatedTeacher | undefined;
    let routeParams: MembershipApprovalRouteParams | undefined;
    try {
      const authenticatedStudent = readAuthenticatedStudent({
        request,
        env,
        now: deps.now,
      });
      if (authenticatedStudent) {
        return jsonResponse(403, {
          error: "UAIS teacher role is required.",
          traceId,
          access: createDeniedAccess("teacher-role-required"),
          redaction: createRedaction(),
        }, traceId);
      }

      authenticatedTeacher = readAuthenticatedTeacher({
        request,
        env,
        now: deps.now,
      });
      if (!authenticatedTeacher) {
        return jsonResponse(401, {
          error: "UAIS teacher authentication is required.",
          traceId,
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        isTeachingMembershipApprovalApiProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS teacher auth provider is not production-ready.",
          traceId,
          access: createDeniedAccess(
            "teacher-auth-provider-not-production-ready",
            authenticatedTeacher,
          ),
          authProviderContract,
          redaction: createRedaction(),
        }, traceId);
      }
      const courseManagementRepository = createUaisTeachingCourseManagementRepository({
        env,
        fetch: deps.fetch,
      });
      if (!courseManagementRepository) {
        assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
      }

      const params = await context.params;
      routeParams = params;
      const { membership, classItem, course, receipt } = await approveTeachingClassMembership({
        dataDir: resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR),
        repository: courseManagementRepository,
        actorId: authenticatedTeacher.actorId,
        classId: params.classId,
        membershipId: params.membershipId,
        traceId,
        now: deps.now,
        audit: {
          requestSource: readAuditRequestSource(request),
          authSession: authenticatedTeacher.authSession,
        },
      });

      return jsonResponse(200, {
        membership,
        classItem,
        course,
        receipt,
        traceId,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId, authenticatedTeacher, routeParams);
    }
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
    !isSafeTeachingMembershipActorId(session.actorId) ||
    !isSafeTeachingMembershipActorId(session.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: session.actorId,
    role: "teacher",
    authSession: {
      sessionId: session.sessionId,
      authenticatedAt: session.authenticatedAt,
      expiresAt: session.expiresAt,
    },
  };
}

function isSafeTeachingMembershipActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
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
  if (
    !claims ||
    claims.role !== "student" ||
    !isSafeTeachingMembershipActorId(claims.account) ||
    !isSafeTeachingMembershipActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function isTeachingMembershipApprovalApiProductionRuntime(
  env: Record<string, string | undefined>,
) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
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
  authenticatedTeacher?: AuthenticatedTeacher,
  routeParams?: MembershipApprovalRouteParams,
) {
  if (error instanceof TeachingCourseManagementStoreError) {
    const access = createDeniedAccessForStoreError(
      error,
      authenticatedTeacher,
      routeParams,
    );
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      // Stable classification beside the prose: an approval that lost the race
      // for a busy class row is retryable, a denied one is not.
      ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
      ...(access ? { access } : {}),
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching membership approval request failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function createDeniedAccessForStoreError(
  error: TeachingCourseManagementStoreError,
  authenticatedTeacher?: AuthenticatedTeacher,
  routeParams?: MembershipApprovalRouteParams,
) {
  if (error.status === 403 && error.message === "Teaching class ownership is required.") {
    return createDeniedAccess(
      "teacher-course-ownership-required",
      authenticatedTeacher,
      routeParams,
    );
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

function createDeniedAccess(
  reasonCode: DeniedAccessReasonCode,
  actor?: AuthenticatedTeacher,
  resource?: MembershipApprovalRouteParams,
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor ? { actor: { actorId: actor.actorId, role: actor.role } } : {}),
    ...(resource ? { resource } : {}),
    redaction: createRedaction(),
  };
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
