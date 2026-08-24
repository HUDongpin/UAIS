import { randomUUID } from "node:crypto";
import {
  normalizeExternalTeachingOperationAuditReadbackRecord,
  isTeachingOperationProductionDatabaseAdapterEvidence,
  normalizeTeachingOperationAuditReadbackDomainProjection,
  normalizeTeachingOperationAuditReadbackEvent,
  readTeachingOperationDatabase,
  resolveTeachingOperationDataDir,
  TeachingOperationStoreError,
  type TeachingOperationAuditEvent,
  type TeachingOperationDomainProjection,
  type TeachingOperationProductionDatabaseAdapterEvidence,
  type TeachingOperationRecord,
  type TeachingOperationRollbackProjection,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";

type TeachingOperationAuditGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  readExternalTeachingOperationAudit?: TeachingOperationExternalAuditAdapter;
};

type AuthenticatedTeacher = {
  sessionId: string;
  actorId: string;
  role: "teacher";
  authenticatedAt: string;
  expiresAt: string;
};

type TeachingOperationCourseOwnership = {
  teacherId: string;
  courseIds?: string[];
};

type GetTeachingOperationCourseOwnership = (input: {
  request: Request;
  authenticatedTeacher: AuthenticatedTeacher;
}) => Promise<TeachingOperationCourseOwnership | undefined>;

type TeachingOperationExternalAuditAdapter = (input: {
  teacherId: string;
}) => Promise<{
  events: TeachingOperationAuditEvent[];
  records: TeachingOperationRecord[];
  domainProjections: TeachingOperationDomainProjection[];
  rollbackRecords: TeachingOperationRollbackReadbackRecord[];
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  storagePolicy: "external-redacted-teaching-operation-audit-log";
  storageWritePolicy: "external-append-only-audit-log";
}>;

type TeachingOperationRollbackReadbackRecord = {
  rollbackId: string;
  action: "rollback-teaching-operation-record";
  teacherId: string;
  targetRecordId: string;
  courseId: string;
  targetOperationId: string;
  targetActionSlot: "primary" | "secondary";
  targetActionId: string;
  rollbackReason: string;
  status: "persisted";
  rolledBackAt: string;
  storagePolicy:
    | "external-redacted-teaching-operation-rollback"
    | "domain-projection-teaching-operation-rollback";
  storageWritePolicy:
    | "external-append-only-rollback-log"
    | "read-only-local-json-file";
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

type TeachingOperationAuditAccessDeniedReason =
  | "authenticated-session-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-role-required"
  | "teacher-course-ownership-required"
  | "teacher-course-ownership-check-failed";

export function createTeachingOperationAuditGetHandler(
  deps: TeachingOperationAuditGetHandlerDeps = {},
) {
  const env = deps.env ?? process.env;
  const getTeachingOperationCourseOwnership =
    deps.getTeachingOperationCourseOwnership ??
    createTeachingOperationCourseOwnershipAdapter({
      env,
      fetch: deps.fetch,
    });

  return async function GET(request: Request) {
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
      if (!getTeachingOperationCourseOwnership) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-required", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }
      let ownership: TeachingOperationCourseOwnership | undefined;
      try {
        ownership = await getTeachingOperationCourseOwnership({
          request,
          authenticatedTeacher,
        });
      } catch {
        return jsonResponse(503, {
          error: "UAIS teaching operation audit course ownership check failed.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-check-failed", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }
      if (!ownership || ownership.teacherId !== authenticatedTeacher.actorId) {
        return jsonResponse(403, {
          error: "UAIS teaching operation course ownership is required.",
          traceId,
          access: createDeniedAccess("teacher-course-ownership-required", {
            actorId: authenticatedTeacher.actorId,
            role: authenticatedTeacher.role,
          }),
          redaction: createRedaction(),
        }, traceId);
      }
      const courseIds = [...new Set(ownership.courseIds ?? [])].sort();
      const courseIdSet = new Set(courseIds);
      const externalAudit =
        deps.readExternalTeachingOperationAudit ??
        createUaisTeachingOperationExternalAuditAdapter({
          env,
          fetch: deps.fetch,
        });

      if (isTeachingOperationProductionRuntime(env) && !externalAudit) {
        throw new TeachingOperationStoreError(
          503,
          "Production teaching operation audit readback requires external storage.",
        );
      }

      if (externalAudit) {
        const externalAuditResult = await externalAudit({
          teacherId: authenticatedTeacher.actorId,
        });
        const auditEvents = externalAuditResult.events.filter((event) =>
          isAuditEventCourseVisible(event, courseIdSet),
        );
        const records = externalAuditResult.records.filter((record) =>
          typeof record.courseId === "string" && courseIdSet.has(record.courseId),
        );
        const domainProjections = externalAuditResult.domainProjections.filter(
          (projection) => courseIdSet.has(projection.courseId),
        );
        const rollbackRecords = externalAuditResult.rollbackRecords.filter(
          (rollbackRecord) =>
            rollbackRecord.teacherId === authenticatedTeacher.actorId &&
            courseIdSet.has(rollbackRecord.courseId),
        );

        return jsonResponse(200, {
          traceId,
          actorId: authenticatedTeacher.actorId,
          courseIds,
          records,
          auditEvents,
          domainProjections,
          rollbackRecords,
          recordCount: records.length,
          auditEventCount: auditEvents.length,
          domainProjectionCount: domainProjections.length,
          rollbackRecordCount: rollbackRecords.length,
          ...(externalAuditResult.productionDatabaseAdapter
            ? { productionDatabaseAdapter: externalAuditResult.productionDatabaseAdapter }
            : {}),
          storagePolicy: externalAuditResult.storagePolicy,
          storageWritePolicy: externalAuditResult.storageWritePolicy,
          responsibleSession: "S12",
          redaction: createRedaction(),
        }, traceId);
      }

      const database = await readTeachingOperationDatabase({
        dataDir: resolveTeachingOperationDataDir(env.UAIS_TEACHING_OPERATIONS_DATA_DIR),
      });
      const records = database.records.filter((record) =>
        typeof record.courseId === "string" && courseIdSet.has(record.courseId),
      );
      const auditEvents = database.auditEvents.filter((event) =>
        isAuditEventCourseVisible(event, courseIdSet),
      );
      const domainProjections = database.domainProjections.filter((projection) =>
        courseIdSet.has(projection.courseId),
      );
      const rollbackRecords = domainProjections
        .filter(isTeachingOperationRollbackProjection)
        .map(createLocalRollbackReadbackRecord);

      return jsonResponse(200, {
        traceId,
        actorId: authenticatedTeacher.actorId,
        courseIds,
        records,
        auditEvents,
        domainProjections,
        rollbackRecords,
        recordCount: records.length,
        auditEventCount: auditEvents.length,
        domainProjectionCount: domainProjections.length,
        rollbackRecordCount: rollbackRecords.length,
        storagePolicy: "local-json-teaching-operation-audit-log",
        storageWritePolicy: "read-only-local-json-file",
        responsibleSession: "S12",
        redaction: createRedaction(),
      }, traceId);
    } catch (error) {
      return createErrorResponse(error, traceId);
    }
  };
}

function createTeachingOperationCourseOwnershipAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): GetTeachingOperationCourseOwnership | undefined {
  const readOwnership = createUaisTeacherAiOwnershipAdapter({
    env: input.env,
    fetch: input.fetch,
  });
  if (!readOwnership) {
    return undefined;
  }

  return async ({ request, authenticatedTeacher }) =>
    readOwnership({
      request,
      authenticatedSession: authenticatedTeacher,
    });
}

function createUaisTeachingOperationExternalAuditAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAuditAdapter | undefined {
  const backendContract = resolveUaisStorageBackendContract({
    envName: "UAIS_TEACHING_OPERATIONS_BACKEND",
    value: input.env.UAIS_TEACHING_OPERATIONS_BACKEND,
    responsibleSession: "S12",
    env: input.env,
  });
  if (isLocalJsonFileStorageBackendContract(backendContract)) {
    return undefined;
  }
  if (!isExternalStorageBackendReadyContract(backendContract)) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit external storage is not ready.",
    );
  }
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ teacherId }) => {
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/audit`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit readback failed.",
      );
    }
    const body = await response.json();
    if (!isRecord(body)) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit readback response is invalid.",
      );
    }
    if ("teacherId" in body) {
      const responseTeacherId = readRequiredString(body.teacherId);
      if (responseTeacherId !== teacherId) {
        throw new TeachingOperationStoreError(
          502,
          "External teaching operation audit readback response is invalid.",
        );
      }
    }
    const events = Array.isArray(body.auditEvents)
      ? body.auditEvents
      : Array.isArray(body.events)
        ? body.events
        : [];
    const records = Array.isArray(body.records) ? body.records : [];
    const domainProjections = Array.isArray(body.domainProjections)
      ? body.domainProjections
      : [];
    const rollbackRecords = Array.isArray(body.rollbackRecords)
      ? body.rollbackRecords
      : Array.isArray(body.rollbacks)
        ? body.rollbacks
        : [];
    const productionDatabaseAdapter =
      isTeachingOperationProductionDatabaseAdapterEvidence(body.productionDatabaseAdapter)
        ? body.productionDatabaseAdapter
        : undefined;
    if (isTeachingOperationProductionRuntime(input.env) && !productionDatabaseAdapter) {
      throw new TeachingOperationStoreError(
        502,
        "External teaching operation audit readback is missing production database adapter evidence.",
      );
    }

    try {
      return {
        events: events.map(normalizeTeachingOperationAuditReadbackEvent),
        records: records.map(normalizeExternalTeachingOperationAuditReadbackRecord),
        domainProjections: domainProjections.map(
          normalizeTeachingOperationAuditReadbackDomainProjection,
        ),
        rollbackRecords: rollbackRecords
          .map(normalizeExternalRollbackReadbackRecord)
          .filter(isDefined),
        ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
        storagePolicy: "external-redacted-teaching-operation-audit-log",
        storageWritePolicy: "external-append-only-audit-log",
      };
    } catch (error) {
      if (error instanceof TeachingOperationStoreError) {
        throw new TeachingOperationStoreError(
          502,
          "External teaching operation audit readback response is invalid.",
        );
      }
      throw error;
    }
  };
}

function isTeachingOperationRollbackProjection(
  projection: TeachingOperationDomainProjection,
): projection is TeachingOperationRollbackProjection {
  return projection.objectType === "operation-rollback";
}

function createLocalRollbackReadbackRecord(
  projection: TeachingOperationRollbackProjection,
): TeachingOperationRollbackReadbackRecord {
  return {
    rollbackId: projection.objectId,
    action: "rollback-teaching-operation-record",
    teacherId: projection.rolledBackBy,
    targetRecordId: projection.targetRecordId,
    courseId: projection.courseId,
    targetOperationId: projection.targetOperationId,
    targetActionSlot: projection.targetActionSlot,
    targetActionId: projection.targetActionId,
    rollbackReason: projection.rollbackReason,
    status: "persisted",
    rolledBackAt: projection.rolledBackAt,
    storagePolicy: projection.storagePolicy,
    storageWritePolicy: "read-only-local-json-file",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeExternalRollbackReadbackRecord(
  value: unknown,
): TeachingOperationRollbackReadbackRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.action !== "rollback-teaching-operation-record" ||
    value.status !== "persisted" ||
    value.storagePolicy !== "external-redacted-teaching-operation-rollback" ||
    value.storageWritePolicy !== "external-append-only-rollback-log" ||
    value.responsibleSession !== "S12"
  ) {
    return undefined;
  }

  const rollbackId = readRequiredString(value.rollbackId);
  const teacherId = readRequiredString(value.teacherId);
  const targetRecordId = readRequiredString(value.targetRecordId);
  const courseId = readRequiredString(value.courseId);
  const targetOperationId = readRequiredString(value.targetOperationId);
  const targetActionSlot = readActionSlot(value.targetActionSlot);
  const targetActionId = readRequiredString(value.targetActionId);
  const rollbackReason = readRequiredString(value.rollbackReason);
  const rolledBackAt = readRequiredString(value.rolledBackAt);

  if (
    !rollbackId ||
    !teacherId ||
    !targetRecordId ||
    !courseId ||
    !targetOperationId ||
    !targetActionSlot ||
    !targetActionId ||
    !rollbackReason ||
    !rolledBackAt
  ) {
    return undefined;
  }

  return {
    rollbackId,
    action: "rollback-teaching-operation-record",
    teacherId,
    targetRecordId,
    courseId,
    targetOperationId,
    targetActionSlot,
    targetActionId,
    rollbackReason,
    status: "persisted",
    rolledBackAt,
    storagePolicy: "external-redacted-teaching-operation-rollback",
    storageWritePolicy: "external-append-only-rollback-log",
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readActionSlot(value: unknown): "primary" | "secondary" | undefined {
  return value === "primary" || value === "secondary" ? value : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isAuditEventCourseVisible(
  event: TeachingOperationAuditEvent,
  courseIds: Set<string>,
) {
  if ("courseId" in event && typeof event.courseId === "string") {
    return courseIds.has(event.courseId);
  }
  if ("impactedCourseIds" in event) {
    return event.impactedCourseIds.some((courseId) => courseIds.has(courseId));
  }
  return false;
}

function readSafeTraceId(request: Request) {
  const headerTraceId = request.headers.get("x-uais-trace-id")?.trim();
  if (headerTraceId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(headerTraceId)) {
    return headerTraceId;
  }
  return `trace-${randomUUID()}`;
}

function isSafeTeachingOperationId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function readAuthenticatedTeacher(input: {
  request: Request;
  env: Record<string, string | undefined>;
  now?: Date;
}) {
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

function readAuthenticatedStudent(input: {
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

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.UAIS_DEPLOYMENT_ENV === "production"
  );
}

function createErrorResponse(error: unknown, traceId: string) {
  if (error instanceof TeachingOperationStoreError) {
    return jsonResponse(error.status, {
      error: error.message,
      traceId,
      redaction: createRedaction(),
    }, traceId);
  }

  return jsonResponse(500, {
    error: "Teaching operation audit request failed.",
    traceId,
    redaction: createRedaction(),
  }, traceId);
}

function jsonResponse(status: number, body: unknown, traceId?: string) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(traceId ? { "x-uais-trace-id": traceId } : {}),
    },
  });
}

function createDeniedAccess(
  reasonCode: TeachingOperationAuditAccessDeniedReason,
  actor?: { actorId: string; role: "teacher" },
) {
  return {
    status: "denied",
    reasonCode,
    responsibleSession: "S12",
    ...(actor ? { actor } : {}),
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
