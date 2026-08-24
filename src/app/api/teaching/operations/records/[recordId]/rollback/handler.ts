import { randomUUID } from "node:crypto";
import {
  createUaisTeachingOperationExternalAuditReadAdapter,
  createUaisTeachingOperationExternalRollbackAdapter,
  readTeachingOperationDatabase,
  resolveTeachingOperationDataDir,
  rollbackTeachingOperationRecord,
  TeachingOperationStoreError,
  type TeachingOperationExternalAuditReadAdapter,
  type TeachingOperationExternalRollbackAdapter,
  type TeachingOperationAuditRequestSource,
  type TeachingOperationRollbackReceipt,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";

type TeachingOperationRecordRollbackRouteContext = {
  params: Promise<{ recordId: string }>;
};

type TeachingOperationRecordRollbackPostHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  readExternalTeachingOperationAudit?: TeachingOperationExternalAuditReadAdapter;
  rollbackExternalTeachingOperation?: TeachingOperationExternalRollbackAdapter;
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

const maxBodyBytes = 100_000;

export function createTeachingOperationRecordRollbackPostHandler(
  deps: TeachingOperationRecordRollbackPostHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env,
    fetch: deps.fetch,
  });

  return async function POST(
    request: Request,
    context: TeachingOperationRecordRollbackRouteContext,
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
          access: createDeniedAccess("authenticated-session-required"),
          redaction: createRedaction(),
        }, traceId);
      }
      const body = await readJsonBody(request);
      if (!isRecord(body) || body.action !== "rollback-teaching-operation-record") {
        throw new TeachingOperationStoreError(400, "Unsupported teaching operation rollback action.");
      }
      const rollbackReason = requireSafeId(body.rollbackReason, "rollback reason");
      const params = await context.params;
      const recordId = requireSafeId(params.recordId, "teaching operation record id");
      const dataDir = resolveTeachingOperationDataDir(env.UAIS_TEACHING_OPERATIONS_DATA_DIR);
      const requestSource = readAuditRequestSource(request);

      if (isExternalTeachingOperationsBackendSelected(env)) {
        const courseId = requireSafeId(body.courseId, "course id");
        if (!readOwnership) {
          return jsonResponse(403, {
            error: "UAIS teaching operation course ownership is required.",
            access: createDeniedAccess("teacher-course-ownership-required", courseId),
            redaction: createRedaction(),
          }, traceId);
        }
        const ownership = await readOwnership({
          request,
          authenticatedSession: authenticatedTeacher,
        });
        if (
          !ownership ||
          ownership.teacherId !== authenticatedTeacher.actorId ||
          !new Set(ownership.courseIds ?? []).has(courseId)
        ) {
          return jsonResponse(403, {
            error: "UAIS teaching operation course ownership is required.",
            access: createDeniedAccess("course-scope-denied", courseId),
            redaction: createRedaction(),
          }, traceId);
        }
        const readExternalTeachingOperationAudit =
          deps.readExternalTeachingOperationAudit ??
          createUaisTeachingOperationExternalAuditReadAdapter({
            env,
            fetch: deps.fetch,
          });
        if (!readExternalTeachingOperationAudit) {
          throw new TeachingOperationStoreError(
            503,
            "Teaching operation external audit readback is not configured.",
          );
        }
        const externalAudit = await readExternalTeachingOperationAudit({
          teacherId: authenticatedTeacher.actorId,
        });
        const targetRecord = externalAudit.records.find(
          (record) => record.recordId === recordId,
        );
        if (!targetRecord) {
          throw new TeachingOperationStoreError(404, "Teaching operation record was not found.");
        }
        if (!targetRecord.courseId) {
          throw new TeachingOperationStoreError(
            409,
            "Teaching operation record has no course scope.",
          );
        }
        if (
          targetRecord.actorId !== authenticatedTeacher.actorId ||
          targetRecord.courseId !== courseId ||
          !new Set(ownership.courseIds ?? []).has(targetRecord.courseId)
        ) {
          return jsonResponse(403, {
            error: "UAIS teaching operation course ownership is required.",
            access: createDeniedAccess("course-scope-denied", targetRecord.courseId),
            redaction: createRedaction(),
          }, traceId);
        }
        const rollbackExternalTeachingOperation =
          deps.rollbackExternalTeachingOperation ??
          createUaisTeachingOperationExternalRollbackAdapter({
            env,
            fetch: deps.fetch,
          });
        if (!rollbackExternalTeachingOperation) {
          throw new TeachingOperationStoreError(
            503,
            "Teaching operation external rollback is not configured.",
          );
        }
        const createdAt = (deps.now ?? new Date()).toISOString();
        const externalRollback = await rollbackExternalTeachingOperation({
          teacherId: authenticatedTeacher.actorId,
          targetRecordId: recordId,
          courseId,
          rollbackReason,
          traceId,
          requestedAt: createdAt,
          requestSource,
        });
        const receipt: TeachingOperationRollbackReceipt = {
          receiptId: externalRollback.rollbackId,
          action: "rollback-teaching-operation-record",
          actorId: authenticatedTeacher.actorId,
          courseId,
          targetRecordId: recordId,
          traceId,
          rollbackReason,
          status: "persisted",
          storagePolicy: "external-redacted-teaching-operation-rollback",
          storageWritePolicy: "external-append-only-rollback-log",
          externalRollback,
          responsibleSession: "S12",
          createdAt,
          redaction: createRedaction(),
        };

        return jsonResponse(200, {
          receipt,
          redaction: createRedaction(),
        }, traceId);
      }

      const database = await readTeachingOperationDatabase({ dataDir });
      const record = database.records.find((item) => item.recordId === recordId);
      if (!record) {
        throw new TeachingOperationStoreError(404, "Teaching operation record was not found.");
      }
      if (!record.courseId) {
        throw new TeachingOperationStoreError(
          409,
          "Teaching operation record has no course scope.",
        );
      }

      if (!readOwnership) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          access: createDeniedAccess("teacher-course-ownership-required", record.courseId),
          redaction: createRedaction(),
        }, traceId);
      }

      const ownership = await readOwnership({
        request,
        authenticatedSession: authenticatedTeacher,
      });
      if (
        !ownership ||
        ownership.teacherId !== authenticatedTeacher.actorId ||
        !new Set(ownership.courseIds ?? []).has(record.courseId)
      ) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          access: createDeniedAccess("course-scope-denied", record.courseId),
          redaction: createRedaction(),
        }, traceId);
      }

      const { receipt } = await rollbackTeachingOperationRecord({
        dataDir,
        recordId,
        actorId: authenticatedTeacher.actorId,
        rollbackReason,
        audit: {
          traceId,
          actorRole: "teacher",
          authMode: "signed-teacher-session",
          requestSource,
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

async function readJsonBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
    throw new TeachingOperationStoreError(413, "Request body is too large.");
  }
  if (!text.trim()) {
    throw new TeachingOperationStoreError(400, "Request body is required.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TeachingOperationStoreError(400, "Request body must be JSON.");
  }
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
    error: "Teaching operation record rollback request failed.",
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
  courseId?: string,
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(courseId ? { resource: { courseId } } : {}),
    redaction: createRedaction(),
  };
}

function requireSafeId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TeachingOperationStoreError(400, `Invalid ${label}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRedaction() {
  return {
    secrets: "omitted",
    localFiles: "omitted",
    assets: "ids-only",
  } as const;
}
