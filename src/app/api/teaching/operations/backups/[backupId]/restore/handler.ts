import { randomUUID } from "node:crypto";
import {
  collectTeachingOperationDatabaseCourseIds,
  readTeachingOperationDatabaseBackup,
  resolveTeachingOperationDataDir,
  restoreTeachingOperationDatabaseBackup,
  TeachingOperationStoreError,
  type TeachingOperationAuditRequestSource,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

type TeachingOperationBackupRestoreRouteContext = {
  params: Promise<{ backupId: string }>;
};

type TeachingOperationBackupRestorePostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
};

type AuthenticatedTeacher = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

type AuthenticatedStudent = {
  actorId: string;
  role: "student";
};

export function createTeachingOperationBackupRestorePostHandler(
  deps: TeachingOperationBackupRestorePostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env,
    fetch: deps.fetch,
  });

  return async function POST(
    request: Request,
    context: TeachingOperationBackupRestoreRouteContext,
  ) {
    const traceId = readSafeTraceId(request);
    try {
      const authProviderContract = resolveUaisTeacherAuthProviderContract({ env });
      if (
        isTeachingOperationProductionRuntime(env) &&
        authProviderContract.productionStatus !== "ready"
      ) {
        return jsonResponse(503, {
          error: "UAIS teacher auth provider is not production-ready.",
          traceId,
          access: createDeniedAccess("teacher-auth-provider-not-production-ready"),
          authProviderContract,
          redaction: createRedaction(),
        }, traceId);
      }

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

      const authenticatedTeacher = readAuthenticatedTeacher({
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
      const params = await context.params;
      assertSafeTeachingOperationBackupId(params.backupId);
      if (isExternalTeachingOperationsBackendSelected(env)) {
        return jsonResponse(409, {
          error:
            "Teaching operation backup restore is only available for local JSON fallback storage.",
          traceId,
          restorePlan: createExternalRestoreDrillPlan({
            teacherId: authenticatedTeacher.actorId,
            backupId: params.backupId,
          }),
          redaction: createRedaction(),
        }, traceId);
      }

      const dataDir = resolveTeachingOperationDataDir(env.UAIS_TEACHING_OPERATIONS_DATA_DIR);
      const backup = await readTeachingOperationDatabaseBackup({
        dataDir,
        backupId: params.backupId,
      });
      if (!backup) {
        throw new TeachingOperationStoreError(404, "Teaching operation backup was not found.");
      }

      const impactedCourseIds = collectTeachingOperationDatabaseCourseIds(backup.database);
      if (impactedCourseIds.length === 0) {
        throw new TeachingOperationStoreError(
          409,
          "Teaching operation backup has no course scope.",
        );
      }

      if (!readOwnership) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          access: createDeniedAccess("teacher-course-ownership-required", impactedCourseIds),
          redaction: createRedaction(),
        }, traceId);
      }

      const ownership = await readOwnership({
        request,
        authenticatedSession: authenticatedTeacher,
      });
      const ownedCourseIds = new Set(ownership?.courseIds ?? []);
      if (
        !ownership ||
        ownership.teacherId !== authenticatedTeacher.actorId ||
        impactedCourseIds.some((courseId) => !ownedCourseIds.has(courseId))
      ) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          access: createDeniedAccess("course-scope-denied", impactedCourseIds),
          redaction: createRedaction(),
        }, traceId);
      }

      const { receipt } = await restoreTeachingOperationDatabaseBackup({
        dataDir,
        backupId: params.backupId,
        actorId: authenticatedTeacher.actorId,
        audit: {
          traceId,
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource: readAuditRequestSource(request),
        },
        now: deps.now,
      });

      return jsonResponse(200, {
        receipt,
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function isExternalTeachingOperationsBackendSelected(env: Record<string, string | undefined>) {
  return env.UAIS_TEACHING_OPERATIONS_BACKEND?.trim().toLowerCase() === "external";
}

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function assertSafeTeachingOperationBackupId(backupId: string) {
  if (!isSafeTeachingOperationId(backupId)) {
    throw new TeachingOperationStoreError(
      400,
      "UAIS teaching operation backup id is invalid.",
    );
  }
}

function createExternalRestoreDrillPlan(input: { teacherId: string; backupId: string }) {
  return {
    status: "external-restore-drill-required",
    action: "verify-teaching-operation-backup-restore",
    backupId: input.backupId,
    route: `/api/external-storage/teaching-operations/${input.teacherId}/backups/${input.backupId}/restore-drill`,
    storagePolicy: "external-redacted-teaching-operation-restore-drill",
    storageWritePolicy: "external-append-only-restore-drill-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
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

  const authenticatedTeacher = readUaisAuthenticatedTeacherSessionFromSignedCookies({
    request: input.request,
    secret,
    now: input.now,
  });
  if (
    !authenticatedTeacher ||
    !isSafeTeachingOperationId(authenticatedTeacher.actorId) ||
    !isSafeTeachingOperationId(authenticatedTeacher.sessionId)
  ) {
    return undefined;
  }

  return authenticatedTeacher;
}

function isSafeTeachingOperationId(value: string) {
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
    !isSafeTeachingOperationId(claims.account) ||
    !isSafeTeachingOperationId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function readAuditRequestSource(request: Request): TeachingOperationAuditRequestSource {
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

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof TeachingOperationStoreError) {
    return jsonResponse(error.status, {
      error: error.message,
      // Stable classification beside the prose, set today for snapshot
      // contention so a client can retry instead of parsing the message.
      ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching operation backup restore request failed.",
    redaction: createRedaction(),
  }, traceId);
}

function jsonResponse(status: number, body: unknown, traceId?: string) {
  const responseBody =
    traceId && isRecord(body) && !("traceId" in body) ? { traceId, ...body } : body;
  return Response.json(responseBody, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(traceId ? { "x-uais-trace-id": traceId } : {}),
    },
  });
}

function createDeniedAccess(
  reasonCode:
    | "authenticated-session-required"
    | "teacher-auth-provider-not-production-ready"
    | "teacher-role-required"
    | "teacher-course-ownership-required"
    | "course-scope-denied",
  courseIds?: string[],
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(courseIds ? { resource: { courseIds } } : {}),
    redaction: createRedaction(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  };
}
