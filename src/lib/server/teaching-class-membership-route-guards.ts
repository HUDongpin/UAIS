import { randomUUID } from "node:crypto";
import { createUaisTeachingCourseManagementRepository } from "@/lib/server/teaching-course-management-external-store";
import {
  assertTeachingCourseManagementLocalJsonRuntimeAllowed,
  resolveTeachingCourseManagementDataDir,
  type TeachingCourseManagementAuditRequestSource,
  type TeachingCourseManagementAuthSessionSummary,
  type TeachingCourseManagementRepository,
  TeachingCourseManagementStoreError,
} from "@/lib/server/teaching-course-management-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

// The auth chain shared by the roster-mutating membership routes: bulk approval
// and the reject/remove status patch. It is the SAME chain the single-membership
// approval route has always run - non-teacher app sessions refused first, then
// the signed teacher session, then the production auth-provider readiness gate,
// then the storage-backend choice - lifted out because three routes carrying
// three hand-copied versions of an authorization ladder is how one of them ends
// up a release behind the other two.

export type TeachingClassMembershipRouteTeacher = {
  actorId: string;
  role: "teacher";
  authSession: TeachingCourseManagementAuthSessionSummary;
};

export type TeachingClassMembershipRouteDeniedReasonCode =
  | "authenticated-session-required"
  | "teacher-role-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-course-ownership-required";

export type TeachingClassMembershipRouteResource = Record<string, string>;

export type TeachingClassMembershipRouteGate =
  | { status: "response"; response: Response }
  | {
      status: "authorized";
      authenticatedTeacher: TeachingClassMembershipRouteTeacher;
      dataDir: string;
      repository?: TeachingCourseManagementRepository;
      audit: {
        requestSource: TeachingCourseManagementAuditRequestSource;
        authSession: TeachingCourseManagementAuthSessionSummary;
      };
    };

export function openTeachingClassMembershipRequest(input: {
  request: Request;
  env: Record<string, string | undefined>;
  traceId: string;
  now?: Date;
  fetch?: typeof fetch;
}): TeachingClassMembershipRouteGate {
  const { request, env, traceId } = input;
  // Students AND admins are refused here. An admin holds a valid app session but
  // never a signed teacher session, so falling through would answer the
  // misleading 401 "authentication required" instead of a role denial.
  if (readNonTeacherAppSessionRole({ request, env, now: input.now })) {
    return {
      status: "response",
      response: teachingMembershipJsonResponse(403, {
        error: "UAIS teacher role is required.",
        traceId,
        access: createTeachingMembershipDeniedAccess("teacher-role-required"),
        redaction: createTeachingMembershipRedaction(),
      }, traceId),
    };
  }

  const authenticatedTeacher = readAuthenticatedTeacher({ request, env, now: input.now });
  if (!authenticatedTeacher) {
    return {
      status: "response",
      response: teachingMembershipJsonResponse(401, {
        error: "UAIS teacher authentication is required.",
        traceId,
        access: createTeachingMembershipDeniedAccess("authenticated-session-required"),
        redaction: createTeachingMembershipRedaction(),
      }, traceId),
    };
  }

  const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
  if (
    isTeachingMembershipApiProductionRuntime(env) &&
    authProviderContract.productionStatus !== "ready"
  ) {
    return {
      status: "response",
      response: teachingMembershipJsonResponse(503, {
        error: "UAIS teacher auth provider is not production-ready.",
        traceId,
        access: createTeachingMembershipDeniedAccess(
          "teacher-auth-provider-not-production-ready",
          authenticatedTeacher,
        ),
        authProviderContract,
        redaction: createTeachingMembershipRedaction(),
      }, traceId),
    };
  }

  const repository = createUaisTeachingCourseManagementRepository({
    env,
    fetch: input.fetch,
  });
  if (!repository) {
    assertTeachingCourseManagementLocalJsonRuntimeAllowed(env);
  }

  return {
    status: "authorized",
    authenticatedTeacher,
    dataDir: resolveTeachingCourseManagementDataDir(env.UAIS_TEACHING_COURSES_DATA_DIR),
    ...(repository ? { repository } : {}),
    audit: {
      requestSource: readTeachingMembershipAuditRequestSource(request),
      authSession: authenticatedTeacher.authSession,
    },
  };
}

export function createTeachingMembershipErrorResponse(input: {
  error: unknown;
  traceId: string;
  failureMessage: string;
  authenticatedTeacher?: TeachingClassMembershipRouteTeacher;
  resource?: TeachingClassMembershipRouteResource;
}) {
  if (input.error instanceof TeachingCourseManagementStoreError) {
    const access =
      input.error.status === 403 &&
      input.error.message === "Teaching class ownership is required."
        ? createTeachingMembershipDeniedAccess(
            "teacher-course-ownership-required",
            input.authenticatedTeacher,
            input.resource,
          )
        : undefined;
    return teachingMembershipJsonResponse(input.error.status, {
      error: input.error.message,
      traceId: input.traceId,
      // Stable classification beside the prose: a roster write that lost the race
      // for a busy course row is retryable, a refused transition is not.
      ...(input.error.reasonCode ? { reasonCode: input.error.reasonCode } : {}),
      ...(access ? { access } : {}),
      redaction: createTeachingMembershipRedaction(),
    }, input.traceId);
  }

  return teachingMembershipJsonResponse(500, {
    error: input.failureMessage,
    traceId: input.traceId,
    redaction: createTeachingMembershipRedaction(),
  }, input.traceId);
}

export function teachingMembershipJsonResponse(
  status: number,
  body: unknown,
  traceId: string,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-uais-trace-id": traceId,
    },
  });
}

export function createTeachingMembershipDeniedAccess(
  reasonCode: TeachingClassMembershipRouteDeniedReasonCode,
  actor?: TeachingClassMembershipRouteTeacher,
  resource?: TeachingClassMembershipRouteResource,
) {
  return {
    status: "denied" as const,
    reasonCode,
    responsibleSession: "S12" as const,
    ...(actor ? { actor: { actorId: actor.actorId, role: actor.role } } : {}),
    ...(resource ? { resource } : {}),
    redaction: createTeachingMembershipRedaction(),
  };
}

export function readTeachingMembershipSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

export function requireSafeTeachingMembershipRouteId(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
  ) {
    throw new TeachingCourseManagementStoreError(400, `Invalid ${label}.`);
  }
  return value;
}

export function createTeachingMembershipRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}

function readAuthenticatedTeacher(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}): TeachingClassMembershipRouteTeacher | undefined {
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

function readNonTeacherAppSessionRole(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}) {
  const claims = getUaisAppSessionClaimsFromCookieString(
    input.request.headers.get("cookie"),
    { env: input.env, now: input.now },
  );
  if (
    !claims ||
    (claims.role !== "student" && claims.role !== "admin") ||
    !isSafeTeachingMembershipActorId(claims.account) ||
    !isSafeTeachingMembershipActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return claims.role;
}

function isSafeTeachingMembershipActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function isTeachingMembershipApiProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function readTeachingMembershipAuditRequestSource(
  request: Request,
): TeachingCourseManagementAuditRequestSource {
  return {
    userAgent: sanitizeRequestSourceHeader(request.headers.get("user-agent")) ?? "unknown",
    ipAddress: "redacted",
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
