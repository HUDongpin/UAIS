import { randomUUID } from "node:crypto";
import {
  isTeachingOperationProductionDatabaseAdapterEvidence,
  readTeachingOperationDatabase,
  resolveTeachingOperationDataDir,
  TeachingOperationStoreError,
  type TeachingOperationAuditEvent,
  type TeachingOperationProductionDatabaseAdapterEvidence,
} from "@/lib/server/teaching-operations-store";
import { createUaisTeacherAiOwnershipAdapter } from "@/lib/server/teacher-ai-ownership-store";
import { resolveUaisTeacherAuthProviderContract } from "@/lib/server/teacher-auth-provider-contract";
import { readUaisAuthenticatedTeacherSessionFromSignedCookies } from "@/lib/server/teacher-auth-session";
import { getUaisAppSessionClaimsFromCookieString } from "@/lib/server/uais-app-session";
import {
  createUaisExternalStorageConfig,
  isExternalStorageBackendReadyContract,
  isLocalJsonFileStorageBackendContract,
  resolveUaisStorageBackendContract,
} from "@/lib/ai/storage-backend-contract";

export const dynamic = "force-dynamic";

type TeachingOperationAuditAlertsGetHandlerDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetch?: typeof fetch;
  getTeachingOperationCourseOwnership?: GetTeachingOperationCourseOwnership;
  readExternalTeachingOperationAuditAlerts?: TeachingOperationExternalAuditAlertsAdapter;
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

type TeachingOperationAuditAlert = {
  alertId: string;
  severity: "high";
  reason: "missing-course-context";
  auditId: string;
  traceId: string;
  actorId: string;
  operationId: string;
  actionSlot: "primary" | "secondary";
  actionId: string;
  createdAt: string;
  redaction: ReturnType<typeof createRedaction>;
};

type TeachingOperationAuditAlertSummary = {
  teacherId: string;
  status: "attention-required" | "clear";
  eventType: "teaching-operation-audit-alert-summary";
  storagePolicy: "external-redacted-teaching-operation-audit-alerts";
  sourceStoragePolicy:
    | "external-redacted-teaching-operation-audit-log"
    | "local-json-teaching-operation-audit-log";
  alertPolicy: {
    policyId: "s12-teaching-operation-audit-alerts-v1";
    checks: ["missing-course-context"];
  };
  sourceRecordCount: number;
  alertCount: number;
  alerts: TeachingOperationAuditAlert[];
  productionDatabaseAdapter?: TeachingOperationProductionDatabaseAdapterEvidence;
  responsibleSession: "S12";
  redaction: ReturnType<typeof createRedaction>;
};

type TeachingOperationExternalAuditAlertsAdapter = (input: {
  teacherId: string;
}) => Promise<TeachingOperationAuditAlertSummary>;

type TeachingOperationAuditAlertsAccessDeniedReason =
  | "authenticated-session-required"
  | "teacher-auth-provider-not-production-ready"
  | "teacher-role-required"
  | "teacher-course-ownership-required";

export const GET = createTeachingOperationAuditAlertsGetHandler();

export function createTeachingOperationAuditAlertsGetHandler(
  deps: TeachingOperationAuditAlertsGetHandlerDeps = {},
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

      const ownership = await getTeachingOperationCourseOwnership({
        request,
        authenticatedTeacher,
      });
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
      const externalAlerts =
        deps.readExternalTeachingOperationAuditAlerts ??
        createUaisTeachingOperationExternalAuditAlertsAdapter({
          env,
          fetch: deps.fetch,
        });
      if (isTeachingOperationProductionRuntime(env) && !externalAlerts) {
        throw new TeachingOperationStoreError(
          503,
          "Production teaching operation audit alerts require external storage.",
        );
      }

      const summary = externalAlerts
        ? await externalAlerts({ teacherId: authenticatedTeacher.actorId })
        : await summarizeLocalTeachingOperationAuditAlerts({
            env,
            teacherId: authenticatedTeacher.actorId,
          });
      assertProductionTeachingOperationAuditAlertDatabaseAdapterEvidence({
        env,
        summary,
      });

      return jsonResponse(200, {
        traceId,
        actorId: authenticatedTeacher.actorId,
        courseIds,
        ...summary,
        notificationRoute: "/api/teaching/operations/audit/alerts/notifications",
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

function createUaisTeachingOperationExternalAuditAlertsAdapter(input: {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}): TeachingOperationExternalAuditAlertsAdapter | undefined {
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
      "Teaching operation audit alert external storage is not ready.",
    );
  }
  const config = createUaisExternalStorageConfig({ env: input.env });
  if (!config) {
    throw new TeachingOperationStoreError(
      503,
      "Teaching operation audit alert external storage is not configured.",
    );
  }
  const fetchImpl = input.fetch ?? fetch;

  return async ({ teacherId }) => {
    const response = await fetchImpl(
      `${config.baseUrl}/teaching-operations/${encodeURIComponent(teacherId)}/audit/alerts`,
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
        "External teaching operation audit alert readback failed.",
      );
    }
    return normalizeTeachingOperationAuditAlertSummary(await response.json(), {
      teacherId,
      sourceStoragePolicy: "external-redacted-teaching-operation-audit-log",
      productionRuntime: isTeachingOperationProductionRuntime(input.env),
    });
  };
}

async function summarizeLocalTeachingOperationAuditAlerts(input: {
  env: Record<string, string | undefined>;
  teacherId: string;
}): Promise<TeachingOperationAuditAlertSummary> {
  const database = await readTeachingOperationDatabase({
    dataDir: resolveTeachingOperationDataDir(input.env.UAIS_TEACHING_OPERATIONS_DATA_DIR),
  });
  const sourceEvents = database.auditEvents.filter(
    (event) =>
      event.actorId === input.teacherId &&
      event.eventType === "teaching-operation.persisted" &&
      !("courseId" in event),
  );
  const alerts = sourceEvents.map(createTeachingOperationAuditAlert);

  return {
    teacherId: input.teacherId,
    status: alerts.length > 0 ? "attention-required" : "clear",
    eventType: "teaching-operation-audit-alert-summary",
    storagePolicy: "external-redacted-teaching-operation-audit-alerts",
    sourceStoragePolicy: "local-json-teaching-operation-audit-log",
    alertPolicy: createAlertPolicy(),
    sourceRecordCount: database.auditEvents.length,
    alertCount: alerts.length,
    alerts,
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationAuditAlertSummary(
  value: unknown,
  fallback: {
    teacherId: string;
    sourceStoragePolicy: TeachingOperationAuditAlertSummary["sourceStoragePolicy"];
    productionRuntime?: boolean;
  },
): TeachingOperationAuditAlertSummary {
  const record = isRecord(value) ? value : {};
  const productionDatabaseAdapter =
    isTeachingOperationProductionDatabaseAdapterEvidence(record.productionDatabaseAdapter)
      ? record.productionDatabaseAdapter
      : undefined;
  if (fallback.productionRuntime && !productionDatabaseAdapter) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation audit alert readback is missing production database adapter evidence.",
    );
  }
  const alerts = Array.isArray(record.alerts)
    ? record.alerts
        .map(normalizeTeachingOperationAuditAlert)
        .filter((alert) =>
          isTeachingOperationAuditAlertVisibleToTeacher(alert, fallback.teacherId),
        )
    : [];

  return {
    teacherId: fallback.teacherId,
    status: alerts.length > 0 ? "attention-required" : "clear",
    eventType: "teaching-operation-audit-alert-summary",
    storagePolicy: "external-redacted-teaching-operation-audit-alerts",
    sourceStoragePolicy: fallback.sourceStoragePolicy,
    alertPolicy: createAlertPolicy(),
    sourceRecordCount: readNonNegativeInteger(record.sourceRecordCount),
    alertCount: alerts.length,
    alerts,
    ...(productionDatabaseAdapter ? { productionDatabaseAdapter } : {}),
    responsibleSession: "S12",
    redaction: createRedaction(),
  };
}

function assertProductionTeachingOperationAuditAlertDatabaseAdapterEvidence(input: {
  env: Record<string, string | undefined>;
  summary: TeachingOperationAuditAlertSummary;
}) {
  if (
    isTeachingOperationProductionRuntime(input.env) &&
    !isTeachingOperationProductionDatabaseAdapterEvidence(
      input.summary.productionDatabaseAdapter,
    )
  ) {
    throw new TeachingOperationStoreError(
      502,
      "External teaching operation audit alert readback is missing production database adapter evidence.",
    );
  }
}

function isTeachingOperationAuditAlertVisibleToTeacher(
  alert: TeachingOperationAuditAlert,
  teacherId: string,
) {
  return alert.actorId === teacherId;
}

function createTeachingOperationAuditAlert(
  event: TeachingOperationAuditEvent,
): TeachingOperationAuditAlert {
  if (event.eventType !== "teaching-operation.persisted") {
    throw new TeachingOperationStoreError(500, "Teaching operation audit alert source is invalid.");
  }

  return {
    alertId: `missing-course-context-${event.auditId}`,
    severity: "high",
    reason: "missing-course-context",
    auditId: event.auditId,
    traceId: event.traceId,
    actorId: event.actorId,
    operationId: event.operationId,
    actionSlot: event.actionSlot,
    actionId: event.actionId,
    createdAt: event.createdAt,
    redaction: createRedaction(),
  };
}

function normalizeTeachingOperationAuditAlert(value: unknown): TeachingOperationAuditAlert {
  if (!isRecord(value)) {
    throw new TeachingOperationStoreError(502, "External teaching operation audit alert is invalid.");
  }
  return {
    alertId: readSafeId(value.alertId, "teaching operation audit alert id"),
    severity: value.severity === "high" ? "high" : "high",
    reason: value.reason === "missing-course-context"
      ? "missing-course-context"
      : "missing-course-context",
    auditId: readSafeId(value.auditId, "teaching operation audit id"),
    traceId: readSafeId(value.traceId, "teaching operation audit trace id"),
    actorId: readSafeId(value.actorId, "teaching operation audit actor id"),
    operationId: readSafeId(value.operationId, "teaching operation id"),
    actionSlot: value.actionSlot === "secondary" ? "secondary" : "primary",
    actionId: readSafeId(value.actionId, "teaching operation action id"),
    createdAt: typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt.trim()
      : new Date(0).toISOString(),
    redaction: createRedaction(),
  };
}

function createAlertPolicy(): TeachingOperationAuditAlertSummary["alertPolicy"] {
  return {
    policyId: "s12-teaching-operation-audit-alerts-v1",
    checks: ["missing-course-context"],
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
    authenticatedTeacher.role !== "teacher" ||
    !isSafeTeachingOperationAuditAlertActorId(authenticatedTeacher.actorId) ||
    !isSafeTeachingOperationAuditAlertActorId(authenticatedTeacher.sessionId)
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
    !isSafeTeachingOperationAuditAlertActorId(claims.account) ||
    !isSafeTeachingOperationAuditAlertActorId(claims.sessionId)
  ) {
    return undefined;
  }
  return {
    actorId: claims.account,
    role: "student",
  };
}

function isSafeTeachingOperationAuditAlertActorId(value: string) {
  return value.length >= 1 && value.length <= 120 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function isTeachingOperationProductionRuntime(env: Record<string, string | undefined>) {
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

function readSafeId(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value.trim())) {
    throw new TeachingOperationStoreError(502, `${label} is invalid.`);
  }
  return value.trim();
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    error: "Teaching operation audit alert request failed.",
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
  reasonCode: TeachingOperationAuditAlertsAccessDeniedReason,
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
